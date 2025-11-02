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

type OllamaPayload = unknown;

function extractOllamaText(payload: OllamaPayload): string {
  if (!payload) return "";
  if (typeof payload === "string") return payload;
  if (typeof payload === "object" && payload !== null) {
    const obj = payload as Record<string, unknown>;
    if (typeof obj.response === "string") return obj.response;
    if (obj.message && typeof obj.message === "object" && obj.message !== null) {
      const message = obj.message as Record<string, unknown>;
      if (typeof message.content === "string") return message.content;
    }
    if (Array.isArray(obj.messages)) {
      const last = obj.messages[obj.messages.length - 1];
      if (last && typeof last === "object" && last !== null) {
        const lastMsg = last as Record<string, unknown>;
        if (typeof lastMsg.content === "string") {
          return lastMsg.content;
        }
      }
    }
    if (Array.isArray(obj.choices)) {
      const choice = obj.choices[0];
      if (choice && typeof choice === "object" && choice !== null) {
        const choiceObj = choice as Record<string, unknown>;
        if (choiceObj.message && typeof choiceObj.message === "object" && choiceObj.message !== null) {
          const message = choiceObj.message as Record<string, unknown>;
          if (message.content) {
            return String(message.content);
          }
        }
      }
    }
  }
  return "";
}

function extractUsage(payload: OllamaPayload) {
  if (!payload || typeof payload !== "object" || payload === null) return undefined;
  const obj = payload as Record<string, unknown>;
  const usage = obj.usage;
  if (!usage || typeof usage !== "object" || usage === null) return undefined;
  const usageObj = usage as Record<string, unknown>;
  const promptTokens = usageObj.prompt_tokens ?? usageObj.promptTokens;
  const completionTokens = usageObj.completion_tokens ?? usageObj.completionTokens;
  const totalTokens = usageObj.total_tokens ?? usageObj.totalTokens ??
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
    } else if (typeof globalThis.fetch === "function") {
      this.fetcher = globalThis.fetch.bind(globalThis);
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
