import type { ModelProvider, ChatRequest, ChatResponse } from "./interfaces.js";
export class BedrockProvider implements ModelProvider {
  name = "bedrock";
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const last = req.messages[req.messages.length - 1]?.content || "";
    return { output: `[bedrock echo] ${last}` };
  }
}
