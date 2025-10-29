import type { ModelProvider, ChatRequest, ChatResponse } from "./interfaces.js";
export class AnthropicProvider implements ModelProvider {
  name = "anthropic";
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const last = req.messages[req.messages.length - 1]?.content || "";
    return { output: `[anthropic echo] ${last}` };
  }
}
