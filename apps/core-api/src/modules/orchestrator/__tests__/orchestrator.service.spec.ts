import { OrchestratorService, DrillGate } from '../orchestrator.service';
import { ConfirmationGate } from '../../agent/confirmation/confirmation-gate.service';
import type { LlmClient, LlmMessage, LlmResponse, ToolDefinition } from '../../agent/llm/llm-client.interface';
import type { AgentTool, ToolContext } from '../../agent/tools/tool.interface';
import type { AgentSkill } from '../../agent/skills/skill.interface';

/** The AVC-shaped drill gate, injected by tests that exercise the gate behavior. After #206 the
 *  orchestrator no longer hardcodes this — production wires it via the factory (later the AVC
 *  vertical, #208). Tests inject it explicitly to prove the mechanism is config-driven. */
const AVC_GATE: DrillGate = {
  broadLayer: new Set(['brand_share', 'market_metric']),
  drillTarget: 'model_metric',
  confirmMessage: '即将下钻到机型（SKU）层。请确认要钻取的价格段/参数，确认后我再继续。',
};

/** Every tool_call announced in an assistant message must have a matching tool result message —
 *  the DeepSeek wire contract. Returns the unanswered tool_call_ids (empty = legal history). */
function danglingToolCallIds(messages: LlmMessage[]): string[] {
  const answered = new Set(messages.filter(m => m.role === 'tool').map(m => m.tool_call_id));
  const announced = messages.flatMap(m => m.tool_calls?.map(c => c.id) ?? []);
  return announced.filter(id => !answered.has(id));
}

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

  // #194 — convergence guardrail: a repeated equivalent tool_call within one turn must NOT
  // re-execute the tool (it spirals token cost), but must still feed a tool_result back so the
  // model has the data. Equivalence = same tool name + same args (pagination ignored).
  it('does not re-execute an equivalent tool_call twice in one turn (dedup)', async () => {
    llm.responses = [
      { type: 'tool_calls', calls: [{ id: 'a', name: 'test_tool', arguments: { objectType: 'brand_share', x: 1 } }] },
      { type: 'tool_calls', calls: [{ id: 'b', name: 'test_tool', arguments: { objectType: 'brand_share', x: 1 } }] },
      { type: 'text', content: 'done' },
    ];
    const events = await collect(orchestrator.run({ user, message: 'go' }));
    // tool executed exactly once despite two equivalent calls
    expect((mockTool.execute as jest.Mock).mock.calls.length).toBe(1);
    // both calls still produced a tool_result (second from cache)
    expect(events.filter(e => e.type === 'tool_result').length).toBe(2);
  });

  it('re-executes when the query shape differs (not a false dedup)', async () => {
    // Different filter value = a genuinely different query → must run again.
    llm.responses = [
      { type: 'tool_calls', calls: [{ id: 'a', name: 'test_tool', arguments: { objectType: 'brand_share', filters: [{ field: 'period', value: '26.04' }] } }] },
      { type: 'tool_calls', calls: [{ id: 'b', name: 'test_tool', arguments: { objectType: 'brand_share', filters: [{ field: 'period', value: '25.12' }] } }] },
      { type: 'text', content: 'done' },
    ];
    await collect(orchestrator.run({ user, message: 'go' }));
    expect((mockTool.execute as jest.Mock).mock.calls.length).toBe(2);
  });

  // #194(b) — soft budget: distinct queries beyond the cap are NOT executed; the model is told
  // to answer from gathered data. Each call has a distinct filter so dedup doesn't mask the cap.
  it('stops executing tools after the per-turn soft budget and steers the model to answer', async () => {
    llm.responses = Array.from({ length: 14 }, (_, k) => ({
      type: 'tool_calls' as const,
      calls: [{ id: `c${k}`, name: 'test_tool', arguments: { objectType: 'brand_share', filters: [{ field: 'period', value: `p${k}` }] } }],
    }));
    llm.responses.push({ type: 'text', content: 'final' });
    const events = await collect(orchestrator.run({ user, message: 'spiral' }));
    // executions are capped well below the 14 distinct calls requested
    expect((mockTool.execute as jest.Mock).mock.calls.length).toBeLessThanOrEqual(10);
    // at least one tool_result carries the "answer from gathered data" steer
    const steered = events.some(e => e.type === 'tool_result' && JSON.stringify((e as any).data).includes('工具调用上限'));
    expect(steered).toBe(true);
  });

  // #203 — the soft-budget steer must push a BEST-EFFORT conclusion from gathered data, NOT a
  // "请回复继续" punt (the eval caught S6/S7 bailing with a coverage table + "请回复继续").
  it('soft-budget steer asks for a best-effort conclusion, not a "please continue" punt', async () => {
    llm.responses = Array.from({ length: 14 }, (_, k) => ({
      type: 'tool_calls' as const,
      calls: [{ id: `c${k}`, name: 'test_tool', arguments: { objectType: 'brand_share', filters: [{ field: 'period', value: `p${k}` }] } }],
    }));
    llm.responses.push({ type: 'text', content: 'final' });
    const events = await collect(orchestrator.run({ user, message: 'spiral', conversationId: 'sb1' }));
    const steerData = events
      .filter(e => e.type === 'tool_result')
      .map(e => JSON.stringify((e as any).data))
      .find(s => s.includes('工具调用上限'));
    expect(steerData).toBeDefined();
    // the steer must NOT instruct the model to ask the user to continue…
    expect(steerData).not.toMatch(/请.*回复.*继续|回复["“]?继续/);
    // …it must instead demand a best-effort conclusion from data already gathered.
    expect(steerData).toMatch(/尽可能完整|基于已.*数据.*作答|直接.*作答|给出.*结论/);
  });

  // #195 — stop-and-confirm before drilling into model_metric (③④) once the broad brand/market
  // layer (①②) has been queried this turn. Prevents the opaque four-hop chain (and the
  // absent-brand spiral) by handing control back to the user before the expensive SKU drill.
  it('pauses for confirmation before a model_metric drill that follows a broad-layer query', async () => {
    const o = new OrchestratorService(llm, [mockTool], [mockSkill], undefined, undefined, [AVC_GATE]);
    llm.responses = [
      { type: 'tool_calls', calls: [{ id: 'a', name: 'test_tool', arguments: { objectType: 'brand_share', filters: [{ field: 'category', value: '电饭煲' }] } }] },
      { type: 'tool_calls', calls: [{ id: 'b', name: 'test_tool', arguments: { objectType: 'model_metric', filters: [{ field: 'category', value: '电饭煲' }] } }] },
      { type: 'text', content: 'should not reach here this turn' },
    ];
    const events = await collect(o.run({ user, message: '诊断电饭煲竞争格局', conversationId: 'c1' }));
    const confirm = events.find(e => e.type === 'confirmation_request');
    expect(confirm).toBeTruthy();
    // the broad query ran; the model_metric drill did NOT execute (it's pending confirmation)
    expect((mockTool.execute as jest.Mock).mock.calls.length).toBe(1);
    expect((mockTool.execute as jest.Mock).mock.calls[0][0].objectType).toBe('brand_share');
  });

  it('does NOT pause for a model_metric query when no broad-layer query preceded it this turn', async () => {
    // A direct "TOP机型" fact query (model_metric first) is single-star and reliable — no drill gate.
    const o = new OrchestratorService(llm, [mockTool], [mockSkill], undefined, undefined, [AVC_GATE]);
    llm.responses = [
      { type: 'tool_calls', calls: [{ id: 'a', name: 'test_tool', arguments: { objectType: 'model_metric', filters: [{ field: 'category', value: '电饭煲' }] } }] },
      { type: 'text', content: 'done' },
    ];
    const events = await collect(o.run({ user, message: 'TOP机型', conversationId: 'c2' }));
    expect(events.find(e => e.type === 'confirmation_request')).toBeFalsy();
    expect((mockTool.execute as jest.Mock).mock.calls.length).toBe(1);
  });

  // ADR-0062 §3 — the gate mechanism is config-driven: with NO drillGates injected, the loop never
  // pauses, even on the exact broad→drill sequence that trips an injected gate.
  it('never pauses when no drill gates are injected (mechanism is a no-op without config)', async () => {
    const o = new OrchestratorService(llm, [mockTool], [mockSkill], undefined, undefined, []);
    llm.responses = [
      { type: 'tool_calls', calls: [{ id: 'a', name: 'test_tool', arguments: { objectType: 'brand_share', filters: [{ field: 'category', value: '电饭煲' }] } }] },
      { type: 'tool_calls', calls: [{ id: 'b', name: 'test_tool', arguments: { objectType: 'model_metric', filters: [{ field: 'category', value: '电饭煲' }] } }] },
      { type: 'text', content: 'done' },
    ];
    const events = await collect(o.run({ user, message: 'go', conversationId: 'nogate' }));
    expect(events.find(e => e.type === 'confirmation_request')).toBeFalsy();
    // both calls executed — nothing was gated
    expect((mockTool.execute as jest.Mock).mock.calls.length).toBe(2);
  });

  // ADR-0062 §3 — the gate triggers on ANY injected config, not AVC type names. A neutral
  // {broad:'a' → drill:'b'} gate must pause before 'b' once 'a' has run this turn.
  it('pauses before an injected gate drill target using neutral (non-AVC) type names', async () => {
    const neutralGate: DrillGate = { broadLayer: new Set(['a']), drillTarget: 'b', confirmMessage: '确认下钻？' };
    const o = new OrchestratorService(llm, [mockTool], [mockSkill], undefined, undefined, [neutralGate]);
    llm.responses = [
      { type: 'tool_calls', calls: [{ id: 'x', name: 'test_tool', arguments: { objectType: 'a' } }] },
      { type: 'tool_calls', calls: [{ id: 'y', name: 'test_tool', arguments: { objectType: 'b' } }] },
      { type: 'text', content: 'unreached' },
    ];
    const events = await collect(o.run({ user, message: 'go', conversationId: 'neutral' }));
    expect(events.find(e => e.type === 'confirmation_request')?.message).toBe('确认下钻？');
    // only the broad 'a' ran; 'b' is pending confirmation
    expect((mockTool.execute as jest.Mock).mock.calls.length).toBe(1);
    expect((mockTool.execute as jest.Mock).mock.calls[0][0].objectType).toBe('a');
  });

  // #199 — drill-gate batch safety. The LLM can return MULTIPLE tool_calls in one assistant
  // message (e.g. a broad brand_share query AND a model_metric drill together). When the gate
  // suspends on the drill, the SIBLING calls in the same assistant message must still get a
  // tool_result, or the suspended history is wire-illegal (DeepSeek 400 on resume).
  it('leaves no dangling sibling tool_call when the drill-gate suspends a multi-call batch', async () => {
    const gate = new ConfirmationGate();
    const o = new OrchestratorService(llm, [mockTool], [mockSkill], gate, undefined, [AVC_GATE]);
    llm.responses = [
      // ONE assistant message, TWO calls: broad layer + the gated drill.
      { type: 'tool_calls', calls: [
        { id: 'broad', name: 'test_tool', arguments: { objectType: 'brand_share', filters: [{ field: 'category', value: '电饭煲' }] } },
        { id: 'drill', name: 'test_tool', arguments: { objectType: 'model_metric', filters: [{ field: 'category', value: '电饭煲' }] } },
      ] },
    ];
    const events = await collect(o.run({ user, message: '诊断并钻取', conversationId: 'cb1' }));
    expect(events.find(e => e.type === 'confirmation_request')).toBeTruthy();
    const pending = await gate.resolve('cb1');
    expect(pending).toBeTruthy();
    // The suspended history must answer every announced tool_call EXCEPT the one pending
    // confirmation (resume completes that one). The broad sibling must NOT dangle.
    expect(danglingToolCallIds(pending!.messages)).toEqual([pending!.toolCallId]);
    expect(pending!.toolCallId).toBe('drill');
  });

  it('resume(confirmed:false) after a multi-call drill pause yields no error and answers', async () => {
    const gate = new ConfirmationGate();
    const o = new OrchestratorService(llm, [mockTool], [mockSkill], gate, undefined, [AVC_GATE]);
    llm.responses = [
      { type: 'tool_calls', calls: [
        { id: 'broad', name: 'test_tool', arguments: { objectType: 'brand_share', filters: [{ field: 'category', value: '电饭煲' }] } },
        { id: 'drill', name: 'test_tool', arguments: { objectType: 'model_metric', filters: [{ field: 'category', value: '电饭煲' }] } },
      ] },
      { type: 'text', content: '基于品牌层数据，结论是…' },
    ];
    await collect(o.run({ user, message: '诊断并钻取', conversationId: 'cb2' }));
    const resumed = await collect(o.resume({ user, conversationId: 'cb2', confirmed: false }));
    // The rejected-drill continuation must produce a real answer, not a wire error.
    expect(resumed.find(e => e.type === 'error')).toBeFalsy();
    expect(resumed.find(e => e.type === 'text')?.content).toContain('结论');
  });

  it('reaches MAX_TOOL_ITERATIONS and emits error', async () => {
    llm.responses = Array(14).fill({ type: 'tool_calls', calls: [{ id: 'tc1', name: 'test_tool', arguments: {} }] });
    const events = await collect(orchestrator.run({ user, message: 'loop' }));
    expect(events.find(e => e.type === 'error')).toBeTruthy();
  });

  it('buildSystemPrompt includes skill prompt', () => {
    const prompt = orchestrator.buildSystemPrompt();
    expect(prompt).toContain('skill prompt');
  });

  it('passes the real tenantId to each skill systemPrompt during run', async () => {
    let seenTenantId: string | undefined;
    // Named 'query' so the no-surface budget-safe fallback (#179, CONSUME set) keeps it —
    // a synthetic name would be narrowed out and its systemPrompt never run.
    const capturingSkill: AgentSkill = {
      name: 'query',
      description: 'captures context',
      tools: ['test_tool'],
      systemPrompt: (ctx) => { seenTenantId = ctx.tenantId; return 'captured'; },
    };
    const o = new OrchestratorService(llm, [mockTool], [capturingSkill]);
    llm.responses = [{ type: 'text', content: 'ok' }];
    await collect(o.run({ user, message: 'hi' }));
    expect(seenTenantId).toBe('t1');
  });

  it('injects the tenant profile into the system prompt when provided', async () => {
    llm.responses = [{ type: 'text', content: 'ok' }];
    const events = await collect(orchestrator.run({
      user, message: 'hi', tenantProfile: '本租户已导入数据：\n- market_metric（1234 行）：category=电饭煲/净水器',
    }));
    const sysPrompt = events.find(e => e.type === 'system_prompt')?.content as string;
    expect(sysPrompt).toContain('本租户已导入数据');
    expect(sysPrompt).toContain('电饭煲');
  });

  it('omits the profile segment when tenantProfile is empty', async () => {
    llm.responses = [{ type: 'text', content: 'ok' }];
    const events = await collect(orchestrator.run({ user, message: 'hi', tenantProfile: '' }));
    const sysPrompt = events.find(e => e.type === 'system_prompt')?.content as string;
    expect(sysPrompt).not.toContain('本租户已导入数据');
  });
});
