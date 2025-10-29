import type { ModelProvider, ChatRequest, ChatResponse } from "./interfaces.js";
export class OpenRouterProvider implements ModelProvider {
  name = "openrouter";
  supportsOAuth = true;
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const last = req.messages[req.messages.length - 1]?.content || "";
    return { output: `[openrouter echo] ${last}` };
  }
}
