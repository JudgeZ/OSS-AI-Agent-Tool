export type ChatRequest = { model?: string; messages: { role: "system"|"user"|"assistant"; content: string }[]; };
export type ChatResponse = { output: string; usage?: { promptTokens?: number; completionTokens?: number } };

export interface ModelProvider {
  name: string;
  supportsOAuth?: boolean;
  chat(req: ChatRequest): Promise<ChatResponse>;
  embed?(input: string[] | string): Promise<number[][]>;
}
