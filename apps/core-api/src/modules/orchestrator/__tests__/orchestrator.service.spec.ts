import { OrchestratorService } from '../orchestrator.service';
import type { LlmClient, LlmMessage, LlmResponse, ToolDefinition } from '../../agent/llm/llm-client.interface';
import type { AgentTool, ToolContext } from '../../agent/tools/tool.interface';
import type { AgentSkill } from '../../agent/skills/skill.interface';

class MockLlm implements LlmClient {
  responses: LlmResponse[] = [];
  async chat(): Promise<string> { return ''; }
  async chatWithTools(_msgs: LlmMessage[], _tools: ToolDefinition[]): Promise<LlmResponse> {
    return this.responses.shift() ?? { type: 'text', content: 'done' };
  }
}

const mockTool: AgentTool = {
  name: 'test_tool',
  description: 'test',
  parameters: {},
  requiresConfirmation: false,
  execute: jest.fn().mockResolvedValue({ ok: true }),
};

const mockSkill: AgentSkill = {
  name: 'test_skill',
  description: 'test',
  tools: ['test_tool'],
  systemPrompt: () => 'skill prompt',
  activationCondition: () => true,
};

const user: any = { id: 'u1', tenantId: 't1', email: 'a@b.com', name: 'A', roleId: 'r1', roleName: 'admin', permissions: ['*'], permissionRules: [] };

describe('OrchestratorService', () => {
  let llm: MockLlm;
  let orchestrator: OrchestratorService;

  beforeEach(() => {
    llm = new MockLlm();
    orchestrator = new OrchestratorService(llm, [mockTool], [mockSkill]);
    jest.clearAllMocks();
  });

  async function collect(gen: AsyncGenerator<any>): Promise<any[]> {
    const events: any[] = [];
    for await (const e of gen) events.push(e);
    return events;
  }

  it('returns text event when LLM responds with text', async () => {
    llm.responses = [{ type: 'text', content: 'hello' }];
    const events = await collect(orchestrator.run({ user, message: 'hi' }));
    expect(events.find(e => e.type === 'text')?.content).toBe('hello');
    expect(events.find(e => e.type === 'done')).toBeTruthy();
  });

  it('executes tool call and continues loop', async () => {
    llm.responses = [
      { type: 'tool_calls', calls: [{ id: 'tc1', name: 'test_tool', arguments: { x: 1 } }] },
      { type: 'text', content: 'done' },
    ];
    const events = await collect(orchestrator.run({ user, message: 'do something' }));
    expect(events.find(e => e.type === 'tool_call')?.name).toBe('test_tool');
    expect(events.find(e => e.type === 'tool_result')).toBeTruthy();
    expect(mockTool.execute).toHaveBeenCalledWith({ x: 1 }, { user });
  });

  it('skill activation scopes available tools', () => {
    const names = orchestrator.getScopedToolNames();
    expect(names.has('test_tool')).toBe(true);
  });

  it('reaches MAX_TOOL_ITERATIONS and emits error', async () => {
    llm.responses = Array(10).fill({ type: 'tool_calls', calls: [{ id: 'tc1', name: 'test_tool', arguments: {} }] });
    const events = await collect(orchestrator.run({ user, message: 'loop' }));
    expect(events.find(e => e.type === 'error')).toBeTruthy();
  });

  it('buildSystemPrompt includes skill prompt', () => {
    const prompt = orchestrator.buildSystemPrompt();
    expect(prompt).toContain('skill prompt');
  });
});
