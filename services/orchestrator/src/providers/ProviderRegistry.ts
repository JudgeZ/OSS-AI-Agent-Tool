import { loadConfig } from "../config.js";
import type { ModelProvider, ChatRequest, ChatResponse } from "./interfaces.js";
import { OpenAIProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";
import { GoogleProvider } from "./google.js";
import { AzureOpenAIProvider } from "./azureOpenAI.js";
import { BedrockProvider } from "./bedrock.js";
import { MistralProvider } from "./mistral.js";
import { OpenRouterProvider } from "./openrouter.js";
import { OllamaProvider } from "./ollama.js";

const registry: Record<string, ModelProvider> = {
  openai: new OpenAIProvider(),
  anthropic: new AnthropicProvider(),
  google: new GoogleProvider() as any,
  azureopenai: new AzureOpenAIProvider(),
  bedrock: new BedrockProvider(),
  mistral: new MistralProvider(),
  openrouter: new OpenRouterProvider(),
  local_ollama: new OllamaProvider()
};

export function getProvider(name: string): ModelProvider | undefined {
  return registry[name];
}

export function routeChat(req: ChatRequest): Promise<ChatResponse> {
  const cfg = loadConfig();
  const enabled = cfg.providers.enabled;
  // extremely naive routing for bootstrap; replace with policy engine later
  const preferred = enabled[0] || "local_ollama";
  const p = getProvider(preferred);
  if (!p) throw new Error(`No provider available: ${preferred}`);
  return p.chat(req);
}
