import type { SecretsStore } from "../auth/SecretsStore.js";
import type { ChatRequest, ChatResponse, ModelProvider } from "./interfaces.js";
import { callWithRetry, ProviderError } from "./utils.js";

type FetcherInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

type FetcherResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<any>;
};

type Fetcher = (input: string, init?: FetcherInit) => Promise<FetcherResponse>;

export type OllamaProviderOptions = {
  defaultModel?: string;
  retryAttempts?: number;
  fetch?: Fetcher;
};

function sanitizeBaseUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function extractOllamaText(payload: any): string {
  if (!payload) return "";
  if (typeof payload === "string") return payload;
  if (typeof payload.response === "string") return payload.response;
  if (payload.message && typeof payload.message.content === "string") return payload.message.content;
  if (Array.isArray(payload.messages)) {
    const last = payload.messages[payload.messages.length - 1];
    if (last && typeof last.content === "string") {
      return last.content;
    }
  }
  if (Array.isArray(payload.choices)) {
    const choice = payload.choices[0];
    if (choice?.message?.content) {
      return String(choice.message.content);
    }
  }
  return "";
}

function extractUsage(payload: any) {
  const usage = payload?.usage;
  if (!usage) return undefined;
  const promptTokens = usage.prompt_tokens ?? usage.promptTokens;
  const completionTokens = usage.completion_tokens ?? usage.completionTokens;
  const totalTokens = usage.total_tokens ?? usage.totalTokens ??
    (typeof promptTokens === "number" && typeof completionTokens === "number"
      ? promptTokens + completionTokens
      : undefined);
  if (
    typeof promptTokens === "number" ||
    typeof completionTokens === "number" ||
    typeof totalTokens === "number"
  ) {
    return { promptTokens, completionTokens, totalTokens };
  }
  return undefined;
}

export class OllamaProvider implements ModelProvider {
  name = "local_ollama";
  private readonly fetcher: Fetcher;

  constructor(private readonly secrets: SecretsStore, private readonly options: OllamaProviderOptions = {}) {
    if (options.fetch) {
      this.fetcher = options.fetch;
    } else if (typeof (globalThis as any).fetch === "function") {
      this.fetcher = (globalThis as any).fetch.bind(globalThis);
    } else {
      throw new ProviderError("No fetch implementation available for Ollama provider", {
        status: 500,
        provider: "local_ollama",
        retryable: false
      });
    }
  }

  private async resolveBaseUrl(): Promise<string> {
    const fromSecret = await this.secrets.get("provider:ollama:baseUrl");
    const fromEnv = process.env.OLLAMA_BASE_URL;
    return sanitizeBaseUrl(fromSecret ?? fromEnv ?? "http://127.0.0.1:11434");
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const model = req.model ?? this.options.defaultModel ?? "llama3.1";
    const baseUrl = await this.resolveBaseUrl();
    const payload = {
      model,
      messages: req.messages,
      stream: false
    };

    const body = await callWithRetry(
      async () => {
        let response: FetcherResponse;
        try {
          response = await this.fetcher(`${baseUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
        } catch (error) {
          throw new ProviderError("Failed to reach Ollama", {
            status: 503,
            provider: this.name,
            retryable: true,
            cause: error
          });
        }
        if (!response.ok) {
          throw new ProviderError(`Ollama responded with ${response.status}`, {
            status: response.status,
            provider: this.name,
            retryable: response.status >= 500
          });
        }
        try {
          return await response.json();
        } catch (error) {
          throw new ProviderError("Failed to parse Ollama response", {
            status: 502,
            provider: this.name,
            retryable: false,
            cause: error
          });
        }
      },
      { attempts: this.options.retryAttempts ?? 2 }
    );

    const output = extractOllamaText(body).trim();
    if (!output) {
      throw new ProviderError("Ollama returned an empty response", {
        status: 502,
        provider: this.name,
        retryable: false
      });
    }

    return {
      output,
      provider: this.name,
      usage: extractUsage(body)
    };
  }
}
