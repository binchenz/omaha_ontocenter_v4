import { AgentService, AgentEvent } from './agent.service';
import { LlmClient, LlmMessage, LlmOptions, LlmResponse, ToolDefinition } from './llm/llm-client.interface';
import { AgentTool, ToolContext } from './tools/tool.interface';
import { AgentSkill, SkillContext } from './skills/skill.interface';
import { CurrentUser as CurrentUserType } from '@omaha/shared-types';

const TEST_USER: CurrentUserType = {
  id: 'u1',
  tenantId: 't1',
  email: 'test@test.com',
  name: 'Test',
  roleId: 'r1',
  roleName: 'admin',
  permissions: ['*'],
  permissionRules: [],
};

class MockLlmClient implements LlmClient {
  private responses: LlmResponse[] = [];
  public lastMessages: LlmMessage[] = [];
  public lastTools: ToolDefinition[] = [];

  queueResponse(response: LlmResponse) {
    this.responses.push(response);
  }

  async chat(): Promise<string> {
    return '';
  }

  async chatWithTools(messages: LlmMessage[], tools?: ToolDefinition[]): Promise<LlmResponse> {
    this.lastMessages = messages;
    this.lastTools = tools ?? [];
    const response = this.responses.shift();
    if (!response) throw new Error('No more mock responses');
    return response;
  }
}

class MockQueryTool implements AgentTool {
  name = 'query_objects';
  description = 'Query object instances';
  parameters = { type: 'object', properties: { objectType: { type: 'string' } } };
  requiresConfirmation = false;

  async execute(args: Record<string, unknown>): Promise<unknown> {
    return { data: [{ id: '1', label: '华东客户A', properties: { region: '华东' } }], meta: { total: 1 } };
  }
}

describe('AgentService', () => {
  let service: AgentService;
  let llm: MockLlmClient;
  let queryTool: MockQueryTool;

  beforeEach(() => {
    llm = new MockLlmClient();
    queryTool = new MockQueryTool();
    service = new AgentService(llm, [queryTool]);
  });

  it('executes a single tool call and returns text response', async () => {
    llm.queueResponse({
      type: 'tool_calls',
      calls: [{ id: 'call_1', name: 'query_objects', arguments: { objectType: 'customer' } }],
    });
    llm.queueResponse({
      type: 'text',
      content: '找到了1个华东地区的客户。',
    });

    const events: AgentEvent[] = [];
    for await (const event of service.run({
      user: TEST_USER,
      message: '找出华东地区的客户',
    })) {
      events.push(event);
    }

    const types = events.map(e => e.type);
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    expect(types).toContain('text');
    expect(types).toContain('done');

    const toolCall = events.find(e => e.type === 'tool_call')!;
    expect(toolCall).toMatchObject({ type: 'tool_call', name: 'query_objects' });

    const toolResult = events.find(e => e.type === 'tool_result')!;
    expect(toolResult).toMatchObject({ type: 'tool_result', name: 'query_objects' });

    const text = events.find(e => e.type === 'text')!;
    expect(text).toMatchObject({ type: 'text', content: '找到了1个华东地区的客户。' });
  });

  it('returns text directly when LLM does not call tools', async () => {
    llm.queueResponse({
      type: 'text',
      content: '你好！有什么可以帮你的？',
    });

    const events: AgentEvent[] = [];
    for await (const event of service.run({
      user: TEST_USER,
      message: '你好',
    })) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'text', content: '你好！有什么可以帮你的？' });
    expect(events[1].type).toBe('done');
  });

  it('includes conversation history in LLM messages', async () => {
    llm.queueResponse({ type: 'text', content: '好的，按销售额降序排列。' });

    const history: LlmMessage[] = [
      { role: 'user', content: '找出华东地区的客户' },
      { role: 'assistant', content: '找到了3个华东地区的客户。' },
    ];

    const events: AgentEvent[] = [];
    for await (const event of service.run({
      user: TEST_USER,
      message: '按销售额排序',
      history,
    })) {
      events.push(event);
    }

    expect(events[0]).toMatchObject({ type: 'text', content: '好的，按销售额降序排列。' });
    const roles = llm.lastMessages.map(m => m.role);
    expect(roles).toEqual(['system', 'user', 'assistant', 'user']);
    expect(llm.lastMessages[1].content).toBe('找出华东地区的客户');
    expect(llm.lastMessages[2].content).toBe('找到了3个华东地区的客户。');
    expect(llm.lastMessages[3].content).toBe('按销售额排序');
  });

  it('terminates with error after max tool iterations', async () => {
    for (let i = 0; i < 6; i++) {
      llm.queueResponse({
        type: 'tool_calls',
        calls: [{ id: `call_${i}`, name: 'query_objects', arguments: { objectType: 'customer' } }],
      });
    }

    const events: AgentEvent[] = [];
    for await (const event of service.run({
      user: TEST_USER,
      message: '无限循环测试',
    })) {
      events.push(event);
    }

    const toolCalls = events.filter(e => e.type === 'tool_call');
    expect(toolCalls.length).toBeLessThanOrEqual(5);

    const errorEvent = events.find(e => e.type === 'error');
    expect(errorEvent).toBeDefined();

    const doneEvent = events.find(e => e.type === 'done');
    expect(doneEvent).toBeDefined();
  });

  it('feeds tool execution errors back to LLM', async () => {
    const failingTool: AgentTool = {
      name: 'failing_tool',
      description: 'Always fails',
      parameters: {},
      requiresConfirmation: false,
      execute: async () => { throw new Error('Connection timeout'); },
    };

    const serviceWithFailingTool = new AgentService(llm, [failingTool]);

    llm.queueResponse({
      type: 'tool_calls',
      calls: [{ id: 'call_1', name: 'failing_tool', arguments: {} }],
    });
    llm.queueResponse({
      type: 'text',
      content: '抱歉，工具执行失败了，请稍后重试。',
    });

    const events: AgentEvent[] = [];
    for await (const event of serviceWithFailingTool.run({
      user: TEST_USER,
      message: '测试失败恢复',
    })) {
      events.push(event);
    }

    expect(events.find(e => e.type === 'text')).toMatchObject({
      type: 'text',
      content: '抱歉，工具执行失败了，请稍后重试。',
    });
    const toolMsg = llm.lastMessages.find(m => m.role === 'tool');
    expect(toolMsg?.content).toContain('Connection timeout');
  });

  it('uses skill system prompt when skills are provided', async () => {
    const skill: AgentSkill = {
      name: 'test-skill',
      description: 'Test skill',
      tools: ['query_objects'],
      systemPrompt: () => '你是测试助手。只回答测试相关问题。',
    };

    const serviceWithSkill = new AgentService(llm, [queryTool], [skill]);
    llm.queueResponse({ type: 'text', content: 'ok' });

    const events: AgentEvent[] = [];
    for await (const event of serviceWithSkill.run({ user: TEST_USER, message: 'hi' })) {
      events.push(event);
    }

    const systemMsg = llm.lastMessages.find(m => m.role === 'system');
    expect(systemMsg?.content).toContain('你是测试助手');
  });

  it('emits confirmation_request for tools that require confirmation', async () => {
    const writeTool: AgentTool = {
      name: 'create_object_type',
      description: 'Create a new object type',
      parameters: { type: 'object', properties: { name: { type: 'string' } } },
      requiresConfirmation: true,
      execute: async () => ({ success: true }),
    };

    const serviceWithWriteTool = new AgentService(llm, [writeTool]);

    llm.queueResponse({
      type: 'tool_calls',
      calls: [{ id: 'call_1', name: 'create_object_type', arguments: { name: 'supplier' } }],
    });

    const events: AgentEvent[] = [];
    for await (const event of serviceWithWriteTool.run({ user: TEST_USER, message: '创建供应商类型' })) {
      events.push(event);
    }

    const confirmEvent = events.find(e => e.type === 'confirmation_request');
    expect(confirmEvent).toBeDefined();
    expect(confirmEvent).toMatchObject({
      type: 'confirmation_request',
      toolName: 'create_object_type',
      args: { name: 'supplier' },
    });

    // Tool should NOT have been executed
    const resultEvent = events.find(e => e.type === 'tool_result');
    expect(resultEvent).toBeUndefined();
  });

  it('only sends tools declared by active skills to the LLM', async () => {
    const readTool: AgentTool = {
      name: 'query_objects',
      description: 'Query objects',
      parameters: { type: 'object', properties: {} },
      requiresConfirmation: false,
      execute: async () => ({ data: [] }),
    };
    const writeTool: AgentTool = {
      name: 'delete_object_type',
      description: 'Delete an object type',
      parameters: { type: 'object', properties: {} },
      requiresConfirmation: true,
      execute: async () => ({ success: true }),
    };
    const skill: AgentSkill = {
      name: 'query',
      description: 'Query skill',
      tools: ['query_objects'],
      systemPrompt: () => 'Query only.',
    };

    const scopedService = new AgentService(llm, [readTool, writeTool], [skill]);
    llm.queueResponse({ type: 'text', content: 'done' });

    for await (const _event of scopedService.run({ user: TEST_USER, message: 'test' })) {}

    expect(llm.lastTools.map(t => t.name)).toEqual(['query_objects']);
    expect(llm.lastTools.map(t => t.name)).not.toContain('delete_object_type');
  });
});
