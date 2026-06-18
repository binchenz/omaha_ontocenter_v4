import { IntentRouter, parseRouteDecision, formatFastAnswer, type RouteDecision } from './intent-router';
import type { LlmClient } from '../agent/llm/llm-client.interface';

/**
 * ADR-0064 §5: the fast/slow intent router. parseRouteDecision (pure verdict parse)
 * and formatFastAnswer (pure templating) are tested directly; route() is tested with
 * a mocked LLM + MetricQueryService. The contract: a simple catalogue lookup takes the
 * fast path; everything else (and any uncertainty) falls through to slow.
 */

const user: any = { id: 'u1', tenantId: 't1', email: 'a@b.c', roleId: 'r1', permissions: [] };

function mockLlm(reply: string): LlmClient {
  return { chat: jest.fn().mockResolvedValue(reply), chatWithTools: jest.fn() } as any;
}

const ENVELOPED_RESULT = {
  metric: '零售额',
  star: 'market_metric',
  result: { groups: [{ key: {}, measures: { 零售额: { display: '3.90 亿元（39,012.84 万元）' } } }] },
};

describe('parseRouteDecision (pure)', () => {
  it('parses a well-formed fast verdict', () => {
    const d = parseRouteDecision('{"route":"fast","metric":"零售额","dimensions":{"category":"电饭煲"},"time":{"month":"26.04"},"intent":"lookup","rankBy":""}');
    expect(d).toEqual({ route: 'fast', metric: '零售额', dimensions: { category: '电饭煲' }, time: { month: '26.04' }, intent: 'lookup', rankBy: undefined });
  });

  it('strips a ```json fence', () => {
    const d = parseRouteDecision('```json\n{"route":"fast","metric":"销量","dimensions":{"category":"电饭煲"},"time":{},"intent":"lookup"}\n```');
    expect(d.route).toBe('fast');
  });

  it('falls back to slow on an explicit slow verdict', () => {
    expect(parseRouteDecision('{"route":"slow"}')).toEqual({ route: 'slow' });
  });

  it('falls back to slow on unparseable output (fail safe)', () => {
    expect(parseRouteDecision('not json at all').route).toBe('slow');
    expect(parseRouteDecision('').route).toBe('slow');
  });

  it('refuses a fast route with no metric or no category (conservative gate)', () => {
    expect(parseRouteDecision('{"route":"fast","metric":"","dimensions":{"category":"电饭煲"}}').route).toBe('slow');
    expect(parseRouteDecision('{"route":"fast","metric":"零售额","dimensions":{}}').route).toBe('slow');
  });

  it('defaults a bad intent to lookup', () => {
    const d = parseRouteDecision('{"route":"fast","metric":"零售额","dimensions":{"category":"电饭煲"},"intent":"weird"}');
    expect(d.route === 'fast' && d.intent).toBe('lookup');
  });
});

describe('formatFastAnswer (pure)', () => {
  it('templates the answer straight from the envelope display (number never via LLM)', () => {
    const decision: RouteDecision & { route: 'fast' } = { route: 'fast', metric: '零售额', dimensions: { category: '电饭煲' }, time: { month: '26.04' }, intent: 'lookup' };
    const ans = formatFastAnswer(decision, ENVELOPED_RESULT);
    expect(ans).toContain('3.90 亿元（39,012.84 万元）');
    expect(ans).toContain('电饭煲');
    expect(ans).toContain('26.04');
    expect(ans).toContain('market_metric');
  });

  it('returns null when there is no measure cell (defer to slow path)', () => {
    const decision: RouteDecision & { route: 'fast' } = { route: 'fast', metric: '零售额', dimensions: { category: '电饭煲' }, time: {}, intent: 'lookup' };
    expect(formatFastAnswer(decision, { metric: '零售额', star: 'market_metric', result: { groups: [] } })).toBeNull();
  });
});

describe('IntentRouter.route', () => {
  function makeRouter(reply: string, queryImpl?: jest.Mock) {
    const metricQuery = { query: queryImpl ?? jest.fn().mockResolvedValue(ENVELOPED_RESULT) } as any;
    return { router: new IntentRouter(mockLlm(reply), metricQuery), metricQuery };
  }

  it('takes the fast path for a simple lookup and returns a templated answer', async () => {
    const { router, metricQuery } = makeRouter('{"route":"fast","metric":"零售额","dimensions":{"category":"电饭煲"},"time":{"month":"26.04"},"intent":"lookup"}');
    const out = await router.route(user, '电饭煲 26.04 的零售额是多少？');
    expect(out).not.toBeNull();
    expect(out!.answer).toContain('3.90 亿元（39,012.84 万元）');
    expect(metricQuery.query).toHaveBeenCalledTimes(1);
  });

  it('falls through to slow (null) for a strategic question', async () => {
    const { router, metricQuery } = makeRouter('{"route":"slow"}');
    const out = await router.route(user, '帮我分析电饭煲市场该怎么打');
    expect(out).toBeNull();
    expect(metricQuery.query).not.toHaveBeenCalled();
  });

  it('falls through to slow for a trend (only lookups take the fast path)', async () => {
    const { router, metricQuery } = makeRouter('{"route":"fast","metric":"零售额","dimensions":{"category":"电饭煲"},"time":{},"intent":"trend"}');
    const out = await router.route(user, '电饭煲零售额趋势');
    expect(out).toBeNull();
    expect(metricQuery.query).not.toHaveBeenCalled();
  });

  it('falls through to slow when the metric is off-catalogue', async () => {
    const { router, metricQuery } = makeRouter('{"route":"fast","metric":"利润率","dimensions":{"category":"电饭煲"},"time":{"month":"26.04"},"intent":"lookup"}');
    const out = await router.route(user, '电饭煲利润率');
    expect(out).toBeNull();
    expect(metricQuery.query).not.toHaveBeenCalled();
  });

  it('falls through to slow when the deterministic execute throws (e.g. DIMENSION_REQUIRED)', async () => {
    const throwing = jest.fn().mockRejectedValue(new Error('DIMENSION_REQUIRED'));
    const { router } = makeRouter('{"route":"fast","metric":"零售额","dimensions":{"category":"电饭煲"},"time":{"month":"26.04"},"intent":"lookup"}', throwing);
    expect(await router.route(user, '电饭煲零售额')).toBeNull();
  });

  it('is disabled (always slow) when no MetricQueryService is wired', async () => {
    const router = new IntentRouter(mockLlm('{"route":"fast","metric":"零售额","dimensions":{"category":"电饭煲"},"time":{},"intent":"lookup"}'));
    expect(router.enabled).toBe(false);
    expect(await router.route(user, '电饭煲零售额')).toBeNull();
  });

  it('classify returns slow when the LLM call fails (fail safe)', async () => {
    const failing = { chat: jest.fn().mockRejectedValue(new Error('LLM down')), chatWithTools: jest.fn() } as any;
    const router = new IntentRouter(failing, { query: jest.fn() } as any);
    expect((await router.classify('anything')).route).toBe('slow');
  });
});
