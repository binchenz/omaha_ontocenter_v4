import type { LlmMessage } from './llm-client.interface';
import { formatToolResultForLlm } from './format-tool-result';

/**
 * The single definition of how a turn's tool calls / results render onto the
 * LLM wire protocol. Both the live orchestrator loop (incremental, one message
 * pushed at a time as tools execute) and Conversation.buildLlmHistory (one-shot
 * replay of a persisted turn) go through these, so a resumed conversation can
 * never drift from a live one.
 */

export interface ToolCallShape {
  id: string;
  name: string;
  args: unknown;
}

/**
 * Build the `assistant` message that announces a batch of tool calls.
 * `content` is null because the assistant turn is the tool calls themselves.
 * When thinking mode is active, `reasoningContent` carries the chain-of-thought
 * that must be round-tripped back to the API on subsequent requests (ADR-0047).
 */
export function toAssistantToolCallMsg(calls: ToolCallShape[], reasoningContent?: string): LlmMessage {
  const msg: LlmMessage = {
    role: 'assistant',
    content: null,
    tool_calls: calls.map((c) => ({
      id: c.id,
      type: 'function' as const,
      function: { name: c.name, arguments: JSON.stringify(c.args) },
    })),
  };
  if (reasoningContent) msg.reasoning_content = reasoningContent;
  return msg;
}

/**
 * Build the `tool` result message answering one tool call. `data` is the raw
 * tool return (or an error/rejection envelope); wrapping is centralized here.
 */
export function toToolResultMsg(toolCallId: string, data: unknown): LlmMessage {
  return {
    role: 'tool',
    content: formatToolResultForLlm(data),
    tool_call_id: toolCallId,
  };
}
