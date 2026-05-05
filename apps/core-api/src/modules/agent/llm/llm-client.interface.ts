export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
}

export interface LlmOptions {
  temperature?: number;
  jsonMode?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type LlmResponse =
  | { type: 'text'; content: string }
  | { type: 'tool_calls'; calls: ToolCall[] };

export interface LlmClient {
  chat(messages: LlmMessage[], options?: LlmOptions): Promise<string>;
  chatWithTools(messages: LlmMessage[], tools: ToolDefinition[], options?: LlmOptions): Promise<LlmResponse>;
}

export const LLM_CLIENT = Symbol('LLM_CLIENT');
