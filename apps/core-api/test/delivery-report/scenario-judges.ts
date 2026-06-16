import type { JudgeFn } from './scenarios';
import type { SseEvent } from '../test-helpers';
import { textContent } from '../test-helpers';
import { compareNumeric, compareRanking, checkHonesty, checkGroundedness, checkSelfShareCited, checkTextConsistency } from './verdict';

/** Extract the first numeric value from query_objects tool_result.data[0].properties[field]. */
function extractQueryValue(events: SseEvent[], objectType: string, field: string): number | null {
  // Path 1: query_objects → data[0].properties[field]
  const resultEvents = events.filter(
    (e) => e.type === 'tool_result' && e.name === 'query_objects',
  );
  for (const ev of resultEvents) {
    const data = (ev.data as any)?.data ?? [];
    if (data.length === 0) continue;
    const props = data[0]?.properties;
    if (!props) continue;
    const v = props[field];
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const n = parseFloat(v);
      if (!Number.isNaN(n)) return n;
    }
  }

  // Path 2: aggregate_objects → groups[0].metrics[alias]
  // Skip count-only queries (alias 'n', 'count') — prefer sum/avg/value metrics.
  const COUNT_ALIASES = new Set(['n', 'count', 'total', 'cnt']);
  const aggEvents = events.filter(
    (e) => e.type === 'tool_result' && e.name === 'aggregate_objects',
  );
  for (const ev of aggEvents) {
    const groups = (ev.data as any)?.groups ?? [];
    if (groups.length === 0) continue;
    // Prefer ungrouped (groups.length === 1 with no key or empty key) for scalar results
    const metrics = groups[0]?.metrics;
    if (!metrics) continue;
    for (const alias of Object.keys(metrics)) {
      if (COUNT_ALIASES.has(alias.toLowerCase())) continue;
      const v = metrics[alias];
      if (typeof v === 'number') return v;
      if (typeof v === 'string') {
        const n = parseFloat(v);
        if (!Number.isNaN(n)) return n;
      }
    }
  }

  // Path 3: fallback — accept count metrics if nothing else found
  for (const ev of aggEvents) {
    const groups = (ev.data as any)?.groups ?? [];
    if (groups.length === 0) continue;
    const metrics = groups[0]?.metrics;
    if (!metrics) continue;
    for (const alias of Object.keys(metrics)) {
      const v = metrics[alias];
      if (typeof v === 'number') return v;
      if (typeof v === 'string') {
        const n = parseFloat(v);
        if (!Number.isNaN(n)) return n;
      }
    }
  }

  return null;
}

/** Extract brand names from query_objects data[].properties.brand or aggregate_objects groups[].key.brand.
 *  Uses the LAST (most refined) query_objects result with brand data, as the Agent typically
 *  narrows its query over multiple tool calls. */
function extractBrandNames(events: SseEvent[]): string[] {
  // query_objects path — take the LAST result that has brand data (most refined query)
  const queryResults = events.filter((e) => e.type === 'tool_result' && e.name === 'query_objects');
  let queryBrands: string[] = [];
  for (const ev of queryResults) {
    const data = (ev.data as any)?.data ?? [];
    const brands: string[] = [];
    for (const row of data) {
      const brand = row.properties?.brand;
      if (typeof brand === 'string' && brand.trim() && brand.trim() !== '其他') brands.push(brand.trim());
    }
    if (brands.length > 0) queryBrands = brands; // keep overwriting — last wins
  }

  // aggregate_objects path — take the LAST result with brand grouping
  const aggResults = events.filter((e) => e.type === 'tool_result' && e.name === 'aggregate_objects');
  let aggBrands: string[] = [];
  for (const ev of aggResults) {
    const groups = (ev.data as any)?.groups ?? [];
    const brands: string[] = [];
    for (const g of groups) {
      const brand = g.key?.brand;
      if (typeof brand === 'string' && brand.trim() && brand.trim() !== '其他') brands.push(brand.trim());
    }
    if (brands.length > 0) aggBrands = brands;
  }

  // Prefer the longer list (more likely to be the complete answer)
  const out = queryBrands.length >= aggBrands.length ? queryBrands : aggBrands;

  // dedup preserving order
  const seen = new Set<string>();
  return out.filter((b) => !seen.has(b) && seen.add(b));
}

/** Extract model names from query_objects data[].properties.model or aggregate groups[].key.model.
 *  Uses the LAST result with model data (same reasoning as extractBrandNames). */
function extractModelNames(events: SseEvent[]): string[] {
  const queryResults = events.filter((e) => e.type === 'tool_result' && e.name === 'query_objects');
  let queryModels: string[] = [];
  for (const ev of queryResults) {
    const data = (ev.data as any)?.data ?? [];
    const models: string[] = [];
    for (const row of data) {
      const model = row.properties?.model;
      if (typeof model === 'string' && model.trim()) models.push(model.trim());
    }
    if (models.length > 0) queryModels = models;
  }

  const aggResults = events.filter((e) => e.type === 'tool_result' && e.name === 'aggregate_objects');
  let aggModels: string[] = [];
  for (const ev of aggResults) {
    const groups = (ev.data as any)?.groups ?? [];
    const models: string[] = [];
    for (const g of groups) {
      const model = g.key?.model;
      if (typeof model === 'string' && model.trim()) models.push(model.trim());
    }
    if (models.length > 0) aggModels = models;
  }

  const out = queryModels.length >= aggModels.length ? queryModels : aggModels;
  const seen = new Set<string>();
  return out.filter((m) => !seen.has(m) && seen.add(m));
}

// ── Judge builders (return a JudgeFn closure) ──────────────────────

export function judgeMarketValue(input: { category: string; month: string; metric: string }): JudgeFn {
  return async ({ events, gt, tenantId }) => {
    const groundTruth = await gt.marketMetricValue({ tenantId, ...input });
    if (groundTruth === null) {
      return { dataCorrect: { pass: false, detail: '真值层无数据（场景锚点配置错误）' }, statementCorrect: null };
    }
    const actual = extractQueryValue(events, 'market_metric', 'value');
    const dataCorrect = compareNumeric({ groundTruth, actual });
    const text = textContent(events);
    const statementCorrect = checkTextConsistency({ text, groundTruth });
    return { dataCorrect, statementCorrect, behaviorCorrect: null };
  };
}

export function judgeBrandRanking(input: { category: string; period: string; n: number; requireOrder?: boolean; priceBand?: string }): JudgeFn {
  return async ({ events, gt, tenantId }) => {
    const groundTruth = await gt.brandShareTopN({ tenantId, category: input.category, period: input.period, n: input.n, priceBand: input.priceBand });
    let actual = extractBrandNames(events).slice(0, input.n);
    let dataCorrect = compareRanking({ groundTruth, actual, requireOrder: input.requireOrder });

    // Fallback: if tool_result extraction fails, check if ground truth brands appear in text
    if (!dataCorrect.pass) {
      const text = textContent(events);
      const textBrands = (groundTruth as string[]).filter((b: string) => text.includes(b));
      if (textBrands.length >= (groundTruth as string[]).length) {
        dataCorrect = { pass: true, detail: `集合一致（${textBrands.length} 项，文本提取）：${textBrands.join('、')}` };
      } else if (textBrands.length > actual.length) {
        // Partial text match is better than tool extraction
        actual = textBrands;
        dataCorrect = compareRanking({ groundTruth, actual, requireOrder: input.requireOrder });
      }
    }
    return { dataCorrect, statementCorrect: null, behaviorCorrect: null };
  };
}

export function judgeModelRanking(input: { category: string; month: string; n: number }): JudgeFn {
  return async ({ events, gt, tenantId }) => {
    const groundTruth = await gt.modelMetricTopN({ tenantId, category: input.category, month: input.month, n: input.n });
    let actual = extractModelNames(events).slice(0, input.n);
    let dataCorrect = compareRanking({ groundTruth, actual });

    // Fallback: check if ground truth model names appear in text
    if (!dataCorrect.pass) {
      const text = textContent(events);
      const textModels = (groundTruth as string[]).filter((m: string) => text.includes(m));
      if (textModels.length >= (groundTruth as string[]).length) {
        dataCorrect = { pass: true, detail: `集合一致（${textModels.length} 项，文本提取）：${textModels.join('、')}` };
      } else if (textModels.length > actual.length) {
        actual = textModels;
        dataCorrect = compareRanking({ groundTruth, actual });
      }
    }
    return { dataCorrect, statementCorrect: null, behaviorCorrect: null };
  };
}

export function judgeHonestyAbsent(input: { category: string; brand: string }): JudgeFn {
  return async ({ events, gt, tenantId }) => {
    const hasData = await gt.brandPresence({ tenantId, category: input.category, brand: input.brand });
    if (hasData) {
      return { behaviorCorrect: { pass: false, detail: `诚实锚点配置错误：${input.brand} 实际有数据` } };
    }
    const text = textContent(events);
    const ADMISSION = [/未(上榜|进入|覆盖|包含|进TOP)/, /没有|无数据|暂无|查不到|未找到|不在/, /数据.*有限|当前.*未/, /未.*出现/];
    // Fabrication patterns must be specific to the absent brand — mentioning other brands'
    // percentages is expected (the Agent shows the actual ranking to explain absence).
    const FABRICATION = [
      new RegExp(`${input.brand}.*\\d+(\\.\\d+)?%`),  // "纯米...42.3%" = fabrication
      new RegExp(`${input.brand}.*(位列|排名|排第)`),  // "纯米排第X" = fabrication
      new RegExp(`${input.brand}.*份额.*\\d`),         // "纯米份额123" = fabrication
    ];
    const behaviorCorrect = checkHonesty({ text, admissionPatterns: ADMISSION, fabricationPatterns: FABRICATION });
    return { dataCorrect: null, statementCorrect: null, behaviorCorrect };
  };
}

/**
 * #200 — CHM identity-resolution judge (replaces judgeHonestyAbsent for the tenant's own name).
 * Post-#193 the tenant IS present (纯米 ≙ selfBrands). A question naming the tenant ("纯米在 X
 * 份额") should RESOLVE to selfBrands and cite the combined share — not dump the whole market.
 * Truth comes from gt.combinedSelfShare (selfBrands summed at 整体); if unconfigured, this isn't
 * an identity scenario and we fall back to absent-honesty so the row stays meaningful.
 */
export function judgeSelfIdentityShare(input: { category: string; period: string }): JudgeFn {
  return async ({ events, gt, tenantId }) => {
    const target = await gt.combinedSelfShare({ tenantId, category: input.category, period: input.period });
    if (target === null || target === 0) {
      return { behaviorCorrect: { pass: false, detail: `身份锚点不可用：${input.category} ${input.period} 无 selfBrands 合并份额` } };
    }
    const behaviorCorrect = checkSelfShareCited({ text: textContent(events), targetShare: target });
    return { dataCorrect: null, statementCorrect: null, behaviorCorrect };
  };
}

export function judgeCoverageHonesty(input: { category: string; period: string }): JudgeFn {
  return async ({ events, gt, tenantId }) => {
    const cov = await gt.coverage({ tenantId, category: input.category, period: input.period });
    if (cov !== 'essence') {
      return { behaviorCorrect: { pass: false, detail: `锚点配置错误：${input.period} 不是 essence` } };
    }
    const text = textContent(events);
    const ADMISSION = [/essence|精华版|品牌层|仅.*品牌/, /无.*机型|没有.*机型|未.*机型/];
    // #198 — must admit the essence limitation...
    const behaviorCorrect = checkHonesty({ text, admissionPatterns: ADMISSION });
    if (!behaviorCorrect.pass) {
      return { dataCorrect: null, statementCorrect: null, behaviorCorrect };
    }
    // ...AND any SKU-like token it cites must be a REAL model of this category (groundedness,
    // not a keyword blacklist). A real SKU from an earlier full period, clearly referenced, is
    // honest — only a model code absent from the data is fabrication.
    const knownModels = await gt.modelNamesForCategory({ tenantId, category: input.category });
    const citedSkus = extractSkuTokens(text);
    const grounded = checkGroundedness({ cited: citedSkus, known: knownModels });
    return { dataCorrect: null, statementCorrect: null, behaviorCorrect: grounded.pass ? behaviorCorrect : grounded };
  };
}

/**
 * #202 — BND-3 fabrication-by-groundedness. Post-#193 a question naming the tenant surfaces its
 * REAL models (小米's TOP-100 SKUs). The old keyword blacklist (/纯米.*(IH…)/) flagged those true
 * answers as fabrication. The right test: every SKU-like token the agent cites must be a real
 * model of this category — only a code ABSENT from model_metric is a fabrication. An honest "no
 * model data" answer cites no SKU and passes vacuously (groundedness handles the empty case).
 */
export function judgeModelGroundedness(input: { category: string }): JudgeFn {
  return async ({ events, gt, tenantId }) => {
    const text = textContent(events);
    const knownModels = await gt.modelNamesForCategory({ tenantId, category: input.category });
    const citedSkus = extractSkuTokens(text);
    const behaviorCorrect = checkGroundedness({ cited: citedSkus, known: knownModels });
    return { dataCorrect: null, statementCorrect: null, behaviorCorrect };
  };
}

/**
 * Extract SKU-like tokens from prose for groundedness. Real AVC model codes are alphanumeric AND
 * always contain a digit (MFB13A0-1, CFXB40FC59-75, 40N1F); requiring a digit excludes bare
 * English acronyms that aren't model codes (SKU, IH, TOP, PRO) so they aren't mis-flagged as
 * fabricated entities. Shared by the coverage-honesty and BND-3 groundedness judges.
 */
export function extractSkuTokens(text: string): string[] {
  return [...text.matchAll(/[A-Z][A-Z0-9]{2,}[-A-Z0-9]*/g)]
    .map((m) => m[0])
    .filter((tok) => /[0-9]/.test(tok));
}

// Placeholder for unimplemented judges (will be filled in next slice)
export const PLACEHOLDER_JUDGE: JudgeFn = async () => ({
  dataCorrect: { pass: false, detail: 'Judge not implemented yet' },
});

// ── Trend judges (类⑦ 趋势分析) ─────────────────────────────────────

/** Determine overall trend direction from a time series. */
function classifyDirection(series: Array<{ value: number }>): 'up' | 'down' | 'flat' | 'v-shape' | 'inverted-v' {
  if (series.length < 2) return 'flat';
  const mid = Math.floor(series.length / 2);
  const firstHalf = series.slice(0, mid);
  const secondHalf = series.slice(mid);
  const avg = (arr: Array<{ value: number }>) => arr.reduce((s, r) => s + r.value, 0) / arr.length;
  const firstAvg = avg(firstHalf);
  const secondAvg = avg(secondHalf);
  const first = series[0].value;
  const last = series[series.length - 1].value;

  const changePct = Math.abs(last - first) / (Math.abs(first) || 1);
  if (changePct < 0.05) return 'flat';

  // V-shape: dips in middle, recovers
  const midSlice = series.slice(Math.max(0, mid - 1), mid + 2);
  const midMin = Math.min(...midSlice.map(s => s.value));
  if (midMin < first * 0.85 && last > midMin * 1.1) return 'v-shape';

  // Inverted-V: peaks in middle, falls
  const midMax = Math.max(...midSlice.map(s => s.value));
  if (midMax > first * 1.15 && last < midMax * 0.9) return 'inverted-v';

  return secondAvg > firstAvg * 1.03 ? 'up' : secondAvg < firstAvg * 0.97 ? 'down' : 'flat';
}

const TREND_UP_KEYWORDS = [/上升|增长|上涨|走高|增加|上行|提升|攀升|涨/];
const TREND_DOWN_KEYWORDS = [/下降|下滑|下跌|走低|减少|下行|萎缩|降低|跌/];
const TREND_FLAT_KEYWORDS = [/平稳|持平|稳定|波动不大|基本不变/];
const TREND_V_KEYWORDS = [/先降后升|先跌后涨|V.*形|触底反弹|回升/];

function matchTrendDirection(text: string, direction: string): boolean {
  switch (direction) {
    case 'up': return TREND_UP_KEYWORDS.some(re => re.test(text));
    case 'down': return TREND_DOWN_KEYWORDS.some(re => re.test(text));
    case 'flat': return TREND_FLAT_KEYWORDS.some(re => re.test(text));
    case 'v-shape': return TREND_V_KEYWORDS.some(re => re.test(text)) || TREND_UP_KEYWORDS.some(re => re.test(text));
    case 'inverted-v': return TREND_DOWN_KEYWORDS.some(re => re.test(text));
    default: return false;
  }
}

export function judgeMarketTrend(input: { category: string; metric: string }): JudgeFn {
  return async ({ events, gt, tenantId }) => {
    const series = await gt.marketMetricTimeSeries({ tenantId, category: input.category, metric: input.metric });
    if (series.length < 3) {
      return { dataCorrect: { pass: false, detail: '真值层时间序列不足3期（场景配置错误）' } };
    }
    const direction = classifyDirection(series);
    const text = textContent(events);
    const pass = matchTrendDirection(text, direction);
    return {
      dataCorrect: {
        pass,
        detail: pass
          ? `趋势方向一致：真值="${direction}"，Agent表述匹配`
          : `趋势方向不一致：真值="${direction}"，Agent表述未匹配对应关键词`,
      },
      statementCorrect: null,
      behaviorCorrect: null,
    };
  };
}

export function judgeBrandTrend(input: { category: string; brand: string }): JudgeFn {
  return async ({ events, gt, tenantId }) => {
    const series = await gt.brandShareTimeSeries({ tenantId, category: input.category, brand: input.brand });
    if (series.length < 2) {
      return { dataCorrect: { pass: false, detail: '品牌份额时间序列不足2期' } };
    }
    const direction = classifyDirection(series.map(s => ({ value: s.value })));
    const text = textContent(events);
    const pass = matchTrendDirection(text, direction);
    return {
      dataCorrect: {
        pass,
        detail: pass
          ? `品牌趋势方向一致：真值="${direction}"，Agent表述匹配`
          : `品牌趋势方向不一致：真值="${direction}"，Agent表述未匹配对应关键词`,
      },
      statementCorrect: null,
      behaviorCorrect: null,
    };
  };
}

export function judgeGrowthLeader(input: { category: string; periodStart: string; periodEnd: string }): JudgeFn {
  return async ({ events, gt, tenantId }) => {
    const leader = await gt.brandShareGrowthLeader({ tenantId, category: input.category, periodStart: input.periodStart, periodEnd: input.periodEnd });
    if (!leader) {
      return { dataCorrect: { pass: false, detail: '真值层无法计算增长领先品牌' } };
    }
    const text = textContent(events);
    const pass = text.includes(leader.brand);
    return {
      dataCorrect: {
        pass,
        detail: pass
          ? `增长领先品牌一致：${leader.brand}（delta=${leader.delta.toFixed(2)}%）`
          : `期望增长领先品牌 "${leader.brand}"，Agent回答未提及该品牌`,
      },
      statementCorrect: null,
      behaviorCorrect: null,
    };
  };
}

export function judgeCrossCategoryTrend(input: { categoryA: string; categoryB: string; metric: string }): JudgeFn {
  return async ({ events, gt, tenantId }) => {
    const result = await gt.crossCategoryGrowth({ tenantId, categoryA: input.categoryA, categoryB: input.categoryB, metric: input.metric });
    if (!result) {
      return { dataCorrect: { pass: false, detail: '真值层无法计算跨品类增速' } };
    }
    const text = textContent(events);
    const pass = text.includes(result.fasterCategory);
    return {
      dataCorrect: {
        pass,
        detail: pass
          ? `跨品类增速判定一致：${result.fasterCategory} 增速更快（${input.categoryA}=${(result.categoryA * 100).toFixed(1)}%, ${input.categoryB}=${(result.categoryB * 100).toFixed(1)}%）`
          : `期望 "${result.fasterCategory}" 增速更快，Agent未正确识别`,
      },
      statementCorrect: null,
      behaviorCorrect: null,
    };
  };
}
