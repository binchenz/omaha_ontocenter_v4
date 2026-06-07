import { OrchestratorService, AgentEvent } from '../../orchestrator/orchestrator.service';
import type { LlmClient, LlmMessage, LlmResponse, ToolDefinition } from '../llm/llm-client.interface';
import type { AgentTool, ToolContext } from '../tools/tool.interface';

/**
 * Test that the orchestrator loop preserves reasoning_content on assistant messages
 * during multi-turn tool calling (Issue #136 / ADR-0047).
 */
describe('OrchestratorService reasoning_content preservation (#136)', () => {
  function buildOrchestrator(llmResponses: LlmResponse[], tools: AgentTool[] = []) {
    let callIndex = 0;
    const capturedMessages: LlmMessage[][] = [];

    const mockLlm: LlmClient = {
      chat: jest.fn(),
      chatWithTools: jest.fn(async (messages: LlmMessage[]) => {
        capturedMessages.push([...messages]);
        return llmResponses[callIndex++];
      }),
    };

    const orchestrator = new OrchestratorService(mockLlm, tools, []);
    return { orchestrator, capturedMessages, mockLlm };
  }

  async function collectEvents(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
    const events: AgentEvent[] = [];
    for await (const e of gen) events.push(e);
    return events;
  }

  const dummyUser = { id: 'u1', tenantId: 't1', email: 'test@test.com', permissions: [] } as any;

  it('preserves reasoning_content on assistant message between tool calls', async () => {
    const echoTool: AgentTool = {
      name: 'echo',
      description: 'Echo input',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
      requiresConfirmation: false,
      execute: async (args) => ({ echoed: args.text }),
    };

    const { orchestrator, capturedMessages } = buildOrchestrator([
      // Turn 1: LLM returns tool_call with reasoning_content
      {
        type: 'tool_calls',
        calls: [{ id: 'call_1', name: 'echo', arguments: { text: 'hello' } }],
        reasoning_content: 'I need to echo the word hello',
      },
      // Turn 2: LLM returns final text
      { type: 'text', content: 'Done! I echoed hello.' },
    ], [echoTool]);

    const messages: LlmMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Echo hello' },
    ];

    await collectEvents(orchestrator.executeLoop(messages, { user: dummyUser }));

    // Second LLM call should have the assistant message WITH reasoning_content
    expect(capturedMessages).toHaveLength(2);
    const secondCallMessages = capturedMessages[1];
    const assistantMsg = secondCallMessages.find(
      m => m.role === 'assistant' && m.tool_calls?.length,
    );
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.reasoning_content).toBe('I need to echo the word hello');
  });

  it('works without reasoning_content (backward compat — flash model)', async () => {
    const echoTool: AgentTool = {
      name: 'echo',
      description: 'Echo input',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
      requiresConfirmation: false,
      execute: async (args) => ({ echoed: args.text }),
    };

    const { orchestrator, capturedMessages } = buildOrchestrator([
      // No reasoning_content (flash model)
      {
        type: 'tool_calls',
        calls: [{ id: 'call_1', name: 'echo', arguments: { text: 'hi' } }],
      },
      { type: 'text', content: 'Done' },
    ], [echoTool]);

    const messages: LlmMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Echo hi' },
    ];

    await collectEvents(orchestrator.executeLoop(messages, { user: dummyUser }));

    const secondCallMessages = capturedMessages[1];
    const assistantMsg = secondCallMessages.find(
      m => m.role === 'assistant' && m.tool_calls?.length,
    );
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.reasoning_content).toBeUndefined();
  });

  it('preserves reasoning_content across multiple tool call rounds', async () => {
    const echoTool: AgentTool = {
      name: 'echo',
      description: 'Echo input',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
      requiresConfirmation: false,
      execute: async (args) => ({ echoed: args.text }),
    };

    const { orchestrator, capturedMessages } = buildOrchestrator([
      // Round 1
      {
        type: 'tool_calls',
        calls: [{ id: 'call_1', name: 'echo', arguments: { text: 'first' } }],
        reasoning_content: 'First thought',
      },
      // Round 2
      {
        type: 'tool_calls',
        calls: [{ id: 'call_2', name: 'echo', arguments: { text: 'second' } }],
        reasoning_content: 'Second thought',
      },
      // Final
      { type: 'text', content: 'All done' },
    ], [echoTool]);

    const messages: LlmMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Echo twice' },
    ];

    await collectEvents(orchestrator.executeLoop(messages, { user: dummyUser }));

    // Third call should see BOTH assistant messages with their respective reasoning_content
    expect(capturedMessages).toHaveLength(3);
    const thirdCallMessages = capturedMessages[2];
    const assistantMsgs = thirdCallMessages.filter(
      m => m.role === 'assistant' && m.tool_calls?.length,
    );
    expect(assistantMsgs).toHaveLength(2);
    expect(assistantMsgs[0].reasoning_content).toBe('First thought');
    expect(assistantMsgs[1].reasoning_content).toBe('Second thought');
  });
});
