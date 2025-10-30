import type { SecretsStore } from "../auth/SecretsStore.js";
import type { ChatMessage, ChatRequest, ChatResponse, ModelProvider } from "./interfaces.js";
import { callWithRetry, ProviderError, requireSecret } from "./utils.js";

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

interface GeminiGenerateResult {
  response: {
    text: () => string;
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
    usageMetadata?: GeminiUsageMetadata;
  };
}

interface GeminiModel {
  generateContent: (payload: {
    contents: Array<{
      role: string;
      parts: Array<{ text: string }>;
    }>;
  }) => Promise<GeminiGenerateResult>;
}

interface GeminiClient {
  getGenerativeModel: (config: {
    model: string;
    systemInstruction?: {
      role: string;
      parts: Array<{ text: string }>;
    };
  }) => GeminiModel;
}

export type GoogleProviderOptions = {
  defaultModel?: string;
  retryAttempts?: number;
  clientFactory?: (config: { apiKey: string }) => Promise<GeminiClient> | GeminiClient;
};

async function defaultClientFactory({ apiKey }: { apiKey: string }): Promise<GeminiClient> {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  return new GoogleGenerativeAI(apiKey) as unknown as GeminiClient;
}

function toGeminiContents(messages: ChatMessage[]) {
  return messages
    .filter(msg => msg.role !== "system")
    .map(msg => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }]
    }));
}

export class GoogleProvider implements ModelProvider {
  name = "google";
  supportsOAuth = true;
  private clientPromise?: Promise<GeminiClient>;

  constructor(private readonly secrets: SecretsStore, private readonly options: GoogleProviderOptions = {}) {}

  private async getClient(): Promise<GeminiClient> {
    if (!this.clientPromise) {
      const apiKey = await requireSecret(this.secrets, this.name, {
        key: "provider:google:apiKey",
        env: "GOOGLE_API_KEY",
        description: "API key"
      });
      const factory = this.options.clientFactory ?? defaultClientFactory;
      this.clientPromise = Promise.resolve(factory({ apiKey }));
    }
    return this.clientPromise;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const client = await this.getClient();
    const modelId = req.model ?? this.options.defaultModel ?? "gemini-1.5-flash";
    const systemMessage = req.messages.find(msg => msg.role === "system")?.content;

    const response = await callWithRetry(
      async () => {
        try {
          const model = client.getGenerativeModel({
            model: modelId,
            systemInstruction: systemMessage
              ? { role: "system", parts: [{ text: systemMessage }] }
              : undefined
          });
          return await model.generateContent({ contents: toGeminiContents(req.messages) });
        } catch (error) {
          throw this.normalizeError(error);
        }
      },
      { attempts: this.options.retryAttempts ?? 2 }
    );

    let output = "";
    try {
      output = response.response.text().trim();
    } catch {
      const firstCandidate = response.response.candidates?.[0]?.content?.parts?.[0]?.text;
      if (firstCandidate) {
        output = firstCandidate.trim();
      }
    }

    if (!output) {
      throw new ProviderError("Google Gemini returned an empty response", {
        status: 502,
        provider: this.name,
        retryable: false
      });
    }

    const usage = response.response.usageMetadata;

    return {
      output,
      provider: this.name,
      usage: usage
        ? {
            promptTokens: usage.promptTokenCount,
            completionTokens: usage.candidatesTokenCount,
            totalTokens: usage.totalTokenCount
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
    const message = typeof (error as any)?.message === "string" ? (error as any).message : "Google Gemini request failed";
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
