import type { ModelProvider, ChatRequest, ChatResponse } from "./interfaces.js";
export class GoogleProvider implements ModelProvider {
  name = "google";
  supportsOAuth = true;
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const last = req.messages[req.messages.length - 1]?.content || "";
    return { output: `[gemini echo] ${last}` };
  }
}
