import type { ModelProvider, ChatRequest, ChatResponse } from "./interfaces.js";

export class OpenAIProvider implements ModelProvider {
  name = "openai";
  async chat(req: ChatRequest): Promise<ChatResponse> {
    // Placeholder: in production, call OpenAI REST with API key from SecretsStore
    const last = req.messages[req.messages.length - 1]?.content || "";
    return { output: `[openai echo] ${last}` };
  }
}
