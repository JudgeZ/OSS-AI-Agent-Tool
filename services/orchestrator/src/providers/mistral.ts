import type { ModelProvider, ChatRequest, ChatResponse } from "./interfaces.js";
export class MistralProvider implements ModelProvider {
  name = "mistral";
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const last = req.messages[req.messages.length - 1]?.content || "";
    return { output: `[mistral echo] ${last}` };
  }
}
