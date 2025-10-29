import type { ModelProvider, ChatRequest, ChatResponse } from "./interfaces.js";
export class AzureOpenAIProvider implements ModelProvider {
  name = "azureopenai";
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const last = req.messages[req.messages.length - 1]?.content || "";
    return { output: `[azure-openai echo] ${last}` };
  }
}
