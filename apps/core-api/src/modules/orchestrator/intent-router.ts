import { Injectable, Logger, Optional } from '@nestjs/common';
import { LlmClient } from '../agent/llm/llm-client.interface';
import type { CurrentUser as CurrentUserType } from '@omaha/shared-types';
import { MetricQueryService } from '../query/metric-query.service';
import { resolveMetric, type MetricIntent } from '../query/metric-resolver';
import { AVC_METRIC_CATALOGUE } from '../query/metric-catalogue';

/**
 * The classifier's verdict. `fast` carries a catalogue selection; `slow` means the
 * question is open/strategic/ambiguous and must run the full multi-step Agent loop.
 */
export type RouteDecision =
  | { route: 'fast'; metric: string; dimensions: Record<string, string>; time: Record<string, string>; intent: MetricIntent; rankBy?: string }
  | { route: 'slow'; reason?: string };

/**
 * IntentRouter (ADR-0064 §5) — the fast/slow dual-path classifier. A simple
 * retrieval question is classified ONCE (a single LLM call, no tool loop), mapped
 * to a catalogue metric, executed deterministically, and returned via the slice-①
 * envelope — sub-second, never entering the 12-iteration Agent loop. Anything
 * genuinely open/strategic/ambiguous returns `slow` and runs the existing loop
 * unchanged.
 *
 * Deliberately CONSERVATIVE: it only takes the fast path when the classifier
 * returns a catalogue metric AND a category, and the metric actually resolves.
 * Any uncertainty falls through to the slow path — the fast path never amputates
 * analytical depth (the honest trade-off in ADR-0064 §5). Orchestration flows
 * (drill gate, four-hop chain) stay in the skill and are only reachable via the
 * slow path — the router routes mechanical retrieval only, it never lifts orchestration.
 *
 * Separable + independently testable: `classify()` (pure parse of the LLM verdict)
 * and `route()` (classify → resolve → execute) can be measured apart from the loop.
 */
@Injectable()
export class IntentRouter {
  private readonly logger = new Logger(IntentRouter.name);

  constructor(
    private readonly llm: LlmClient,
    @Optional() private readonly metricQuery?: MetricQueryService,
  ) {}

  /** Whether the fast path is available at all (catalogue + executor present). */
  get enabled(): boolean {
    return !!this.metricQuery;
  }

  /**
   * Classify a user message into a fast/slow route. One LLM call in JSON mode.
   * On any error (LLM failure, unparseable output) it returns `slow` — fail safe:
   * a misclassification toward slow is harmless (just the current behavior).
   */
  async classify(message: string): Promise<RouteDecision> {
    try {
      const raw = await this.llm.chat(
        [
          { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
          { role: 'user', content: message },
        ],
        { jsonMode: true, temperature: 0 },
      );
      return parseRouteDecision(raw);
    } catch (err) {
      this.logger.warn({ msg: 'intent classify failed, falling back to slow path', error: (err as Error).message });
      return { route: 'slow', reason: 'classify-error' };
    }
  }

  /**
   * Attempt the fast path for `message`. Returns the deterministic metric result
   * when it fires, or `null` to signal "run the slow path". Never throws into the
   * caller — a resolve/execute failure also returns null (fall through to slow).
   */
  async route(user: CurrentUserType, message: string): Promise<FastPathOutcome | null> {
    if (!this.metricQuery) return null;
    const decision = await this.classify(message);
    if (decision.route !== 'fast') return null;

    // Scope: the fast path takes ONLY single-point lookups — the A1–A6 month-report
    // retrievals that dominate volume and drive the latency tail. trend/rank still
    // run the slow path: they want a chart / a ranked narrative the loop renders.
    if (decision.intent !== 'lookup') return null;

    // Guard: only fire when the metric truly resolves in the catalogue.
    if (!resolveMetric(decision.metric, AVC_METRIC_CATALOGUE)) {
      this.logger.debug({ msg: 'fast-path metric not in catalogue, slow path', metric: decision.metric });
      return null;
    }

    try {
      const result = await this.metricQuery.query(user, {
        metric: decision.metric,
        dimensions: decision.dimensions,
        time: decision.time,
        intent: decision.intent,
        rankBy: decision.rankBy,
      });
      const answer = formatFastAnswer(decision, result);
      // No answer cell (e.g. an empty aggregate) → defer to the slow path, which can
      // probe coverage and answer honestly rather than emit a bare "no data".
      if (!answer) return null;
      return { taken: true, selection: decision, result, answer };
    } catch (err) {
      // A binding/DIMENSION_REQUIRED/engine error on the fast path → fall through to
      // the slow path, which can ask the user or recover. Never surface a raw throw.
      this.logger.debug({ msg: 'fast-path execute failed, slow path', error: (err as Error).message });
      return null;
    }
  }
}

export interface FastPathOutcome {
  taken: true;
  selection: RouteDecision & { route: 'fast' };
  result: MetricQueryResultShape;
  /** The deterministic, templated answer — the measure value comes straight from
   *  the envelope's `display`, so on the fast path the number never passes through
   *  ANY LLM (the strongest BUG-1 guard). */
  answer: string;
}

/** The structural subset of MetricQueryResult the answer formatter reads. */
interface MetricQueryResultShape {
  metric: string;
  star: string;
  result: { groups: Array<{ key: Record<string, unknown>; measures?: Record<string, { display: string }> }> };
}

/**
 * Build the deterministic fast-path answer from the enveloped lookup result.
 * Returns null when there is no measure cell (empty aggregate) so the caller can
 * defer to the slow path. Pure; exported for unit testing.
 */
export function formatFastAnswer(decision: RouteDecision & { route: 'fast' }, out: MetricQueryResultShape): string | null {
  const group = out.result.groups[0];
  const cell = group?.measures?.[out.metric];
  if (!cell) return null;
  const category = decision.dimensions.category ?? '';
  const scopeBits = [category, ...Object.values(decision.dimensions).filter((v) => v !== category), ...Object.values(decision.time)].filter(Boolean);
  const scope = scopeBits.join(' ');
  return `${scope ? `${scope} 的` : ''}${out.metric}：${cell.display}。（来源：AVC ${out.star}）`;
}

/** The classifier system prompt — names the controlled vocabulary and the strict output shape. */
const CLASSIFIER_SYSTEM_PROMPT = [
  '你是一个意图分流器。判断用户问题是否是「简单的单指标取数」，能直接用指标目录一次查询回答。',
  '指标目录（仅这些算简单取数）：零售额、零售量、零售均价、份额（及同义词 销额/GMV/销量/均价/占比/市场份额 等）。',
  '只有当问题是：取某品类（必要时某品牌/价格段）在某期或某段时间的上述某一个指标（单点/趋势/排名），才算 fast。',
  '以下一律 slow：诊断/为什么/分析原因/战略建议/多指标对比/跨星推理/含糊宽泛/需要澄清/叙述性（用户怎么说）/目录外指标。',
  '只输出 JSON，不要多余文字。格式：',
  '{"route":"fast","metric":"零售额","dimensions":{"category":"电饭煲"},"time":{"month":"26.04"},"intent":"lookup","rankBy":""}',
  '或 {"route":"slow"}。',
  'intent ∈ lookup(单点) / trend(趋势,time 留空) / rank(排名,需 rankBy 如 brand)。',
  'dimensions 至少要有 category 才能 fast；拿不准品类就输出 slow。time 用 {"month":"YY.MM"} 或 {"period":"YY.MM"} 或 {"year":"YY"}。',
  '注意口径：零售均价 lookup 必须固定到单月（time={"month":"YY.MM"}），跨期/按年均价请输出 slow（要销量加权）。份额 lookup 必须带 brand（dimensions 含 brand），否则输出 slow。',
].join('\n');

/**
 * Pure parse of the classifier's raw JSON output into a RouteDecision. Exported for
 * unit testing. Any malformed/short shape → slow (fail safe). The fast route is only
 * honoured when it carries a non-empty metric AND a category dimension.
 */
export function parseRouteDecision(raw: string): RouteDecision {
  let obj: unknown;
  try {
    obj = JSON.parse(stripJsonFence(raw));
  } catch {
    return { route: 'slow', reason: 'unparseable' };
  }
  if (!obj || typeof obj !== 'object') return { route: 'slow', reason: 'not-object' };
  const o = obj as Record<string, unknown>;
  if (o.route !== 'fast') return { route: 'slow' };

  const metric = typeof o.metric === 'string' ? o.metric.trim() : '';
  const dimensions = isStringMap(o.dimensions) ? (o.dimensions as Record<string, string>) : {};
  const time = isStringMap(o.time) ? (o.time as Record<string, string>) : {};
  const intent = o.intent === 'trend' || o.intent === 'rank' ? o.intent : 'lookup';
  const rankBy = typeof o.rankBy === 'string' && o.rankBy.trim() ? o.rankBy.trim() : undefined;

  // Conservative gate: a fast route needs a metric and a category (else slow).
  if (!metric) return { route: 'slow', reason: 'no-metric' };
  if (!dimensions.category) return { route: 'slow', reason: 'no-category' };

  return { route: 'fast', metric, dimensions, time, intent, rankBy };
}

/** Strip a ```json … ``` fence if the model wrapped its output. */
function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fence ? fence[1] : trimmed;
}

/** True iff value is a flat object of string→string. */
function isStringMap(v: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string');
}
