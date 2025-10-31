import type { SecretsStore } from "../auth/SecretsStore.js";
import type { ChatMessage, ChatRequest, ChatResponse, ModelProvider } from "./interfaces.js";
import { callWithRetry, ProviderError, requireSecret } from "./utils.js";

interface AzureUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

interface AzureChatResponse {
  choices: Array<{ message?: { content?: string } } | null>;
  usage?: AzureUsage;
}

interface AzureOpenAIClient {
  getChatCompletions: (
    deployment: string,
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }> ,
    options?: { temperature?: number }
  ) => Promise<AzureChatResponse>;
}

export type AzureOpenAIProviderOptions = {
  defaultDeployment?: string;
  retryAttempts?: number;
  apiVersion?: string;
  clientFactory?: (config: { apiKey: string; endpoint: string; apiVersion?: string }) => Promise<AzureOpenAIClient> | AzureOpenAIClient;
};

async function defaultClientFactory({
  apiKey,
  endpoint,
  apiVersion
}: {
  apiKey: string;
  endpoint: string;
  apiVersion?: string;
}): Promise<AzureOpenAIClient> {
  const azureModule = await import("@azure/openai");
  const moduleExports = azureModule as Record<string, unknown>;
  const ctorCandidate = moduleExports.AzureOpenAI ?? moduleExports.default;
  if (typeof ctorCandidate !== "function") {
    throw new Error("Azure OpenAI client is not available");
  }
  const AzureOpenAIConstructor = ctorCandidate as new (...args: any[]) => unknown;
  return new AzureOpenAIConstructor({ apiKey, endpoint, apiVersion }) as unknown as AzureOpenAIClient;
}

function toAzureMessages(messages: ChatMessage[]) {
  return messages.map(msg => ({ role: msg.role, content: msg.content }));
}

export class AzureOpenAIProvider implements ModelProvider {
  name = "azureopenai";
  private clientPromise?: Promise<AzureOpenAIClient>;

  constructor(private readonly secrets: SecretsStore, private readonly options: AzureOpenAIProviderOptions = {}) {}

  private async getClient(): Promise<AzureOpenAIClient> {
    if (!this.clientPromise) {
      const apiKey = await requireSecret(this.secrets, this.name, {
        key: "provider:azureopenai:apiKey",
        env: "AZURE_OPENAI_API_KEY",
        description: "API key"
      });
      const endpoint = await requireSecret(this.secrets, this.name, {
        key: "provider:azureopenai:endpoint",
        env: "AZURE_OPENAI_ENDPOINT",
        description: "endpoint"
      });
      const factory = this.options.clientFactory ?? defaultClientFactory;
      this.clientPromise = Promise.resolve(
        factory({ apiKey, endpoint, apiVersion: this.options.apiVersion })
      );
    }
    return this.clientPromise;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const client = await this.getClient();
    const deployment =
      req.model ??
      this.options.defaultDeployment ??
      (await this.secrets.get("provider:azureopenai:deployment")) ??
      process.env.AZURE_OPENAI_DEPLOYMENT;

    if (!deployment) {
      throw new ProviderError("Azure OpenAI deployment is not configured", {
        status: 400,
        provider: this.name,
        code: "missing_deployment",
        retryable: false
      });
    }

    const response = await callWithRetry(
      async () => {
        try {
          return await client.getChatCompletions(deployment, toAzureMessages(req.messages), {
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
      throw new ProviderError("Azure OpenAI returned an empty response", {
        status: 502,
        provider: this.name,
        retryable: false
      });
    }

    const usage = response.usage;

    return {
      output,
      provider: this.name,
      usage: usage
        ? {
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens
          }
        : undefined
    };
  }

  private normalizeError(error: unknown): ProviderError {
    if (error instanceof ProviderError) {
      return error;
    }
    const status = typeof (error as any)?.statusCode === "number"
      ? (error as any).statusCode
      : typeof (error as any)?.status === "number"
      ? (error as any).status
      : undefined;
    const code = typeof (error as any)?.code === "string" ? (error as any).code : undefined;
    const message = typeof (error as any)?.message === "string" ? (error as any).message : "Azure OpenAI request failed";
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
