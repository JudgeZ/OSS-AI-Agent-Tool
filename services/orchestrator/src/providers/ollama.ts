import type { ModelProvider, ChatRequest, ChatResponse } from "./interfaces.js";
export class OllamaProvider implements ModelProvider {
  name = "local_ollama";
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const last = req.messages[req.messages.length - 1]?.content || "";
    return { output: `[ollama echo] ${last}` };
  }
}
