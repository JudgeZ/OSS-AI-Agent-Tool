export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatRequest = {
  model?: string;
  messages: ChatMessage[];
};

export type TokenUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type ChatResponse = {
  output: string;
  provider?: string;
  usage?: TokenUsage;
  warnings?: string[];
};

export interface ModelProvider {
  name: string;
  supportsOAuth?: boolean;
  chat(req: ChatRequest): Promise<ChatResponse>;
  embed?(input: string[] | string): Promise<number[][]>;
}
