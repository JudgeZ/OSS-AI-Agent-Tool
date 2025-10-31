import { loadConfig } from "../config.js";
import { LocalFileStore, VaultStore, type SecretsStore } from "../auth/SecretsStore.js";
import type { ChatRequest, ChatResponse, ModelProvider } from "./interfaces.js";
import { AzureOpenAIProvider } from "./azureOpenAI.js";
import { AnthropicProvider } from "./anthropic.js";
import { BedrockProvider } from "./bedrock.js";
import { GoogleProvider } from "./google.js";
import { MistralProvider } from "./mistral.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAIProvider } from "./openai.js";
import { OpenRouterProvider } from "./openrouter.js";
import { ProviderError } from "./utils.js";

let secretsStore: SecretsStore | undefined;
let cachedRegistry: Record<string, ModelProvider> | undefined;
const overrides = new Map<string, ModelProvider>();

export function getSecretsStore(): SecretsStore {
  if (!secretsStore) {
    const cfg = loadConfig();
    secretsStore =
      cfg.secrets.backend === "vault"
        ? new VaultStore({
            address: cfg.secrets.vault?.address,
            token: cfg.secrets.vault?.token,
            namespace: cfg.secrets.vault?.namespace,
            mount: cfg.secrets.vault?.mount,
            prefix: cfg.secrets.vault?.prefix,
            caCertPath: cfg.secrets.vault?.caCertPath,
            tlsRejectUnauthorized: cfg.secrets.vault?.tlsRejectUnauthorized
          })
        : new LocalFileStore();
  }
  return secretsStore;
}

function buildRegistry(): Record<string, ModelProvider> {
  if (!cachedRegistry) {
    const secrets = getSecretsStore();
    cachedRegistry = {
      openai: new OpenAIProvider(secrets),
      anthropic: new AnthropicProvider(secrets),
      google: new GoogleProvider(secrets),
      azureopenai: new AzureOpenAIProvider(secrets),
      bedrock: new BedrockProvider(secrets),
      mistral: new MistralProvider(secrets),
      openrouter: new OpenRouterProvider(secrets),
      local_ollama: new OllamaProvider(secrets)
    };
  }
  return cachedRegistry;
}

export function getProvider(name: string): ModelProvider | undefined {
  if (overrides.has(name)) {
    return overrides.get(name);
  }
  return buildRegistry()[name];
}

export function setProviderOverride(name: string, provider: ModelProvider | undefined): void {
  if (provider) {
    overrides.set(name, provider);
  } else {
    overrides.delete(name);
  }
}

export function clearProviderOverrides(): void {
  overrides.clear();
}

export async function routeChat(req: ChatRequest): Promise<ChatResponse> {
  const cfg = loadConfig();
  const enabled = cfg.providers.enabled.map(p => p.trim()).filter(Boolean);
  if (enabled.length === 0) {
    throw new ProviderError("No providers are enabled for chat", {
      status: 503,
      provider: "router",
      retryable: false
    });
  }

  const warnings: string[] = [];
  const errors: ProviderError[] = [];

  for (const providerName of enabled) {
    const provider = getProvider(providerName);
    if (!provider) {
      warnings.push(`${providerName}: provider not registered`);
      errors.push(
        new ProviderError(`Provider ${providerName} is not registered`, {
          status: 503,
          provider: providerName,
          retryable: false
        })
      );
      continue;
    }

    try {
      const response = await provider.chat(req);
      const mergedWarnings = warnings.length
        ? [...warnings, ...(response.warnings ?? [])]
        : response.warnings;
      return {
        ...response,
        provider: response.provider ?? provider.name,
        warnings: mergedWarnings?.length ? mergedWarnings : undefined
      };
    } catch (error) {
      const providerError =
        error instanceof ProviderError
          ? error
          : new ProviderError(
              error instanceof Error ? error.message : "Provider request failed",
              {
                status: typeof (error as any)?.status === "number" ? (error as any).status : 502,
                provider: provider.name,
                retryable: false,
                cause: error
              }
            );
      warnings.push(`${provider.name}: ${providerError.message}`);
      errors.push(providerError);
    }
  }

  const message = errors.length
    ? errors.map(err => `[${err.provider ?? "unknown"}] ${err.message}`).join("; ")
    : "All providers failed";
  const status =
    errors.find(err => err.status >= 400 && err.status < 500)?.status ??
    errors[errors.length - 1]?.status ??
    502;
  throw new ProviderError(message, {
    status,
    provider: "router",
    retryable: errors.some(err => err.retryable),
    details: errors.map(err => ({ provider: err.provider ?? "unknown", message: err.message, status: err.status }))
  });
}
