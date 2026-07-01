export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  /** DeepSeek thinking-mode chain-of-thought content (V4+). */
  reasoning_content?: string;
}

export interface LlmOptions {
  temperature?: number;
  jsonMode?: boolean;
  /** Override the default model (e.g. 'deepseek-v4-pro' for research-qa). */
  model?: string;
  /** Enable/disable thinking mode (DeepSeek V4+). */
  thinking?: { type: 'enabled' | 'disabled' };
  /** Thinking effort level when thinking is enabled. */
  reasoningEffort?: 'high' | 'max';
  /**
   * Per-call timeout override in ms. When set, wins over the client-level
   * default and the thinking/non-thinking derivation (see ResilientLlmClient).
   */
  timeoutMs?: number;
  /**
   * Abort signal threaded into the underlying fetch. ResilientLlmClient composes
   * this with its own per-attempt deadline controller, so a caller-side abort
   * (e.g. SSE client disconnect) AND the deadline both cancel the in-flight call.
   */
  signal?: AbortSignal;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Enable strict JSON Schema validation on the DeepSeek beta endpoint. */
  strict?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type LlmResponse =
  | { type: 'text'; content: string; reasoning_content?: string }
  | { type: 'tool_calls'; calls: ToolCall[]; reasoning_content?: string };

export interface LlmClient {
  chat(messages: LlmMessage[], options?: LlmOptions): Promise<string>;
  chatWithTools(messages: LlmMessage[], tools: ToolDefinition[], options?: LlmOptions): Promise<LlmResponse>;
}

export const LLM_CLIENT = Symbol('LLM_CLIENT');
