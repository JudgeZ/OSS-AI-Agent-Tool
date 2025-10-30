import type { SecretsStore } from "../auth/SecretsStore.js";
import type { ChatRequest, ChatResponse, ModelProvider } from "./interfaces.js";
import { callWithRetry, ProviderError, requireSecret } from "./utils.js";

interface MistralChatResponse {
  choices: Array<{ message?: { content?: string } } | null>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

interface MistralApiClient {
  chat: (payload: {
    model: string;
    messages: ChatRequest["messages"];
    temperature?: number;
  }) => Promise<MistralChatResponse>;
}

export type MistralProviderOptions = {
  defaultModel?: string;
  retryAttempts?: number;
  clientFactory?: (config: { apiKey: string }) => Promise<MistralApiClient> | MistralApiClient;
};

async function defaultClientFactory({ apiKey }: { apiKey: string }): Promise<MistralApiClient> {
  const { MistralClient } = await import("@mistralai/mistralai");
  return new MistralClient({ apiKey }) as unknown as MistralApiClient;
}

export class MistralProvider implements ModelProvider {
  name = "mistral";
  private clientPromise?: Promise<MistralApiClient>;

  constructor(private readonly secrets: SecretsStore, private readonly options: MistralProviderOptions = {}) {}

  private async getClient(): Promise<MistralApiClient> {
    if (!this.clientPromise) {
      const apiKey = await requireSecret(this.secrets, this.name, {
        key: "provider:mistral:apiKey",
        env: "MISTRAL_API_KEY",
        description: "API key"
      });
      const factory = this.options.clientFactory ?? defaultClientFactory;
      this.clientPromise = Promise.resolve(factory({ apiKey }));
    }
    return this.clientPromise;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const client = await this.getClient();
    const model = req.model ?? this.options.defaultModel ?? "mistral-large-latest";

    const response = await callWithRetry(
      async () => {
        try {
          return await client.chat({
            model,
            messages: req.messages,
            temperature: 0.2
          });
        } catch (error) {
          throw this.normalizeError(error);
        }
      },
      { attempts: this.options.retryAttempts ?? 2 }
    );

    const output = response.choices[0]?.message?.content?.trim();
    if (!output) {
      throw new ProviderError("Mistral returned an empty response", {
        status: 502,
        provider: this.name,
        retryable: false
      });
    }

    return {
      output,
      provider: this.name,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens
          }
        : undefined
    };
  }

  private normalizeError(error: unknown): ProviderError {
    if (error instanceof ProviderError) {
      return error;
    }
    const status = typeof (error as any)?.status === "number" ? (error as any).status : undefined;
    const code = typeof (error as any)?.code === "string" ? (error as any).code : undefined;
    const message = typeof (error as any)?.message === "string" ? (error as any).message : "Mistral request failed";
    const retryable = status === 429 || status === 408 || (typeof status === "number" ? status >= 500 : true);
    return new ProviderError(message, {
      status: status ?? 502,
      code,
      provider: this.name,
      retryable,
      cause: error
    });
  }
}
