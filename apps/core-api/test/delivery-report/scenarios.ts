import type { Anchors, CategoryAnchor } from './anchors';
import type { GroundTruth } from './ground-truth';
import type { Verdict } from './verdict';
import type { SseEvent } from '../test-helpers';

/** A judge runs after the agent answers: given the SSE events + the truth oracle, return verdicts. */
export type JudgeFn = (ctx: {
  events: SseEvent[];
  gt: GroundTruth;
  tenantId: string;
}) => Promise<ScenarioVerdict>;

export interface ScenarioVerdict {
  /** 取数正确性 (fact track) — tool_result vs SQL truth. Null for behavior-only scenarios. */
  dataCorrect?: Verdict | null;
  /** 表述正确性 (fact track) — text self-consistency. Null when not applicable. */
  statementCorrect?: Verdict | null;
  /** 行为正确性 (behavior track) — honesty / stop-and-confirm. Null for fact-only scenarios. */
  behaviorCorrect?: Verdict | null;
}

export interface RunnableScenario {
  id: string;
  category: BusinessCategory;
  difficulty: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  track: 'fact' | 'behavior';
  question: string;
  /** For fact scenarios: the objectType the agent SHOULD query (universe correctness). */
  expectObjectType?: string;
  judge: JudgeFn;
}

export type BusinessCategory =
  | '市场大盘体检'
  | '品牌竞争格局'
  | '纯米自家定位'
  | '价格段攻防'
  | '机型级洞察'
  | '知识边界诚实'
  | '趋势分析';

// Extraction + judge helpers live in scenario-judges.ts to keep this file declarative.
import {
  judgeMarketValue,
  judgeBrandRanking,
  judgeModelRanking,
  judgeSelfIdentityShare,
  judgeModelGroundedness,
  judgeMarketTrend,
  judgeBrandTrend,
  judgeGrowthLeader,
  judgeCrossCategoryTrend,
} from './scenario-judges';

/**
 * Build the full scenario catalog from probed anchors. Questions are instantiated against the
 * leading category (most data) so they always hit real data; re-ingest widens the catalog
 * automatically. 6 business categories × 3–5 examples, difficulty as a label only.
 */
export function buildScenarios(anchors: Anchors): RunnableScenario[] {
  const cat = anchors.categories[0];
  if (!cat) return [];
  const out: RunnableScenario[] = [];

  out.push(...marketScenarios(cat));
  out.push(...brandScenarios(cat));
  out.push(...chunmiScenariosImpl(cat, anchors.absentBrand));
  out.push(...priceBandScenariosImpl(cat));
  out.push(...modelScenariosImpl(cat));
  out.push(...boundaryScenariosImpl(cat, anchors.absentBrand));
  out.push(...trendScenariosImpl(anchors));

  return out;
}

// ── 类① 市场大盘体检 ──────────────────────────────────────────────
function marketScenarios(cat: CategoryAnchor): RunnableScenario[] {
  const c = cat.name;
  const m = cat.latestMarketMonth;
  const mk = (id: string, question: string, difficulty: RunnableScenario['difficulty'], metric: string): RunnableScenario => ({
    id, category: '市场大盘体检', difficulty, track: 'fact', question,
    expectObjectType: 'market_metric',
    judge: judgeMarketValue({ category: c, month: m, metric }),
  });
  return [
    mk('MKT-1', `${c} ${m} 的零售额是多少？`, 'L1', '零售额'),
    mk('MKT-2', `${c} ${m} 的零售量是多少？`, 'L1', '零售量'),
    mk('MKT-3', `${c} ${m} 的零售均价是多少？`, 'L2', '零售均价'),
    mk('MKT-4', `帮我看下 ${c} ${m} 的市场零售额规模。`, 'L2', '零售额'),
  ];
}

// ── 类② 品牌竞争格局 ──────────────────────────────────────────────
function brandScenarios(cat: CategoryAnchor): RunnableScenario[] {
  const c = cat.name;
  const p = cat.latestBrandPeriod;
  return [
    {
      id: 'BRD-1', category: '品牌竞争格局', difficulty: 'L2', track: 'fact',
      question: `${c} ${p} 品牌份额排名前 5 是哪些品牌？`,
      expectObjectType: 'brand_share',
      judge: judgeBrandRanking({ category: c, period: p, n: 5 }),
    },
    {
      id: 'BRD-2', category: '品牌竞争格局', difficulty: 'L2', track: 'fact',
      question: `${c} ${p} 市场份额最高的品牌是谁？`,
      expectObjectType: 'brand_share',
      judge: judgeBrandRanking({ category: c, period: p, n: 1 }),
    },
    {
      id: 'BRD-3', category: '品牌竞争格局', difficulty: 'L3', track: 'fact',
      question: `${c} ${p} 份额前三的品牌分别是？请按高到低排序。`,
      expectObjectType: 'brand_share',
      judge: judgeBrandRanking({ category: c, period: p, n: 3, requireOrder: true }),
    },
  ];
}

// placeholder category builders are defined in the next slice

// IMPL_PLACEHOLDER

// IMPL_PLACEHOLDER

// ── 类③ 纯米自家定位（#200：身份解析——用公司名问也应解析到 selfBrands 并报合并份额） ──
function chunmiScenariosImpl(cat: CategoryAnchor, selfName: string): RunnableScenario[] {
  const c = cat.name;
  const p = cat.latestBrandPeriod;
  const mk = (id: string, question: string, difficulty: RunnableScenario['difficulty']): RunnableScenario => ({
    id, category: '纯米自家定位', difficulty, track: 'behavior',
    question,
    // Post-#193/#200 the tenant is NOT absent — naming it must resolve to selfBrands + cite the
    // combined share, not dump the whole market nor claim "无数据". (Was judgeHonestyAbsent.)
    judge: judgeSelfIdentityShare({ category: c, period: p }),
  });
  return [
    mk('CHM-1', `${selfName}在${c} ${p} 的市场份额是多少？`, 'L3'),
    mk('CHM-2', `${selfName}在${c} ${p} 的整体份额、在市场上大概什么水平？`, 'L3'),
    mk('CHM-3', `帮我分析下${selfName}在${c}的竞争表现，我们最新一期整体份额是多少？`, 'L4'),
  ];
}

// ── 类④ 价格段攻防 ────────────────────────────────────────────────
function priceBandScenariosImpl(cat: CategoryAnchor): RunnableScenario[] {
  const c = cat.name;
  const p = cat.latestBrandPeriod;
  const bands = cat.priceBands;
  const top = bands.find((b) => b.includes('300')) ?? bands[0];
  const out: RunnableScenario[] = [];
  if (top) {
    out.push({
      id: 'PRC-1', category: '价格段攻防', difficulty: 'L3', track: 'fact',
      question: `${c} ${p} ${top} 价格段份额最高的品牌是谁？`,
      expectObjectType: 'brand_share',
      judge: judgeBrandRanking({ category: c, period: p, n: 1, priceBand: top }),
    });
    out.push({
      id: 'PRC-2', category: '价格段攻防', difficulty: 'L4', track: 'fact',
      question: `${c} ${p} ${top} 价格段品牌份额前三是哪些？`,
      expectObjectType: 'brand_share',
      judge: judgeBrandRanking({ category: c, period: p, n: 3, priceBand: top }),
    });
  }
  const second = bands.find((b) => b !== top) ?? top;
  if (second) {
    out.push({
      id: 'PRC-3', category: '价格段攻防', difficulty: 'L4', track: 'fact',
      question: `${c} ${p} ${second} 价格段哪个品牌份额领先？`,
      expectObjectType: 'brand_share',
      judge: judgeBrandRanking({ category: c, period: p, n: 1, priceBand: second }),
    });
  }
  return out;
}

// ── 类⑤ 机型级洞察 ────────────────────────────────────────────────
function modelScenariosImpl(cat: CategoryAnchor): RunnableScenario[] {
  const c = cat.name;
  const m = cat.latestModelMonth;
  return [
    {
      id: 'MDL-1', category: '机型级洞察', difficulty: 'L4', track: 'fact',
      question: `${c} ${m} 销额份额最高的 10 款机型是哪些？`,
      expectObjectType: 'model_metric',
      judge: judgeModelRanking({ category: c, month: m, n: 10 }),
    },
    {
      id: 'MDL-2', category: '机型级洞察', difficulty: 'L4', track: 'fact',
      question: `${c} ${m} 销额份额最高的机型是哪一款？`,
      expectObjectType: 'model_metric',
      judge: judgeModelRanking({ category: c, month: m, n: 1 }),
    },
    {
      id: 'MDL-3', category: '机型级洞察', difficulty: 'L5', track: 'fact',
      question: `${c} ${m} 销额份额 TOP5 机型，请按从高到低列出。`,
      expectObjectType: 'model_metric',
      judge: judgeModelRanking({ category: c, month: m, n: 5 }),
    },
  ];
}

// ── 类⑥ 知识边界诚实 ──────────────────────────────────────────────
function boundaryScenariosImpl(cat: CategoryAnchor, absentBrand: string): RunnableScenario[] {
  const c = cat.name;
  return [
    {
      id: 'BND-1', category: '知识边界诚实', difficulty: 'L4', track: 'behavior',
      question: `${c} 99.99 期的零售额是多少？`,
      judge: async ({ events }) => {
        // A nonexistent period → correct answer admits no data, must not fabricate a number.
        const text = (events.find((e) => e.type === 'text') as any)?.content ?? '';
        const ADMISSION = [/没有|无数据|暂无|查不到|未找到|不存在|无法/];
        const FABRICATION = [/零售额.*\d+.*[万亿元]/];
        const { checkHonesty: ch } = await import('./verdict');
        return { behaviorCorrect: ch({ text, admissionPatterns: ADMISSION, fabricationPatterns: FABRICATION }) };
      },
    },
    {
      id: 'BND-2', category: '知识边界诚实', difficulty: 'L4', track: 'behavior',
      question: `请告诉我"__不存在的品类__"最新一期的品牌份额排名。`,
      judge: async ({ events }) => {
        const text = (events.find((e) => e.type === 'text') as any)?.content ?? '';
        const ADMISSION = [/没有|无数据|暂无|查不到|未找到|不存在|无法|未覆盖/];
        const FABRICATION = [/份额.*\d+(\.\d+)?%/];
        const { checkHonesty: ch } = await import('./verdict');
        return { behaviorCorrect: ch({ text, admissionPatterns: ADMISSION, fabricationPatterns: FABRICATION }) };
      },
    },
    {
      id: 'BND-3', category: '知识边界诚实', difficulty: 'L5', track: 'behavior',
      question: `${absentBrand}在${c}的旗舰机型用的是什么加热技术？参数是多少？`,
      // #202 — judge by GROUNDEDNESS, not a keyword blacklist. Post-#193 the agent surfaces the
      // tenant's REAL models; the old /纯米.*(IH…)/ regex flagged those true answers as fabrication.
      // Any cited SKU must exist in model_metric; a code absent from the data is the only fabrication.
      judge: judgeModelGroundedness({ category: c }),
    },
  ];
}

// ── 类⑦ 趋势分析 ─────────────────────────────────────────────────────
function trendScenariosImpl(anchors: Anchors): RunnableScenario[] {
  const cat = anchors.categories[0];
  if (!cat) return [];
  const c = cat.name;
  const periods = cat.allBrandPeriods;
  const earliest = periods[0] ?? '';
  const latest = periods[periods.length - 1] ?? cat.latestBrandPeriod;
  const topBrand = cat.topBrands[0] ?? '美的';
  // Pick a second category for cross-category comparison
  const secondCat = anchors.categories.length > 1 ? anchors.categories[1].name : '';

  const out: RunnableScenario[] = [];

  out.push({
    id: 'TRD-1', category: '趋势分析', difficulty: 'L2', track: 'fact',
    question: `${c} 从 ${earliest} 到 ${latest} 零售额的整体趋势如何？`,
    expectObjectType: 'market_metric',
    judge: judgeMarketTrend({ category: c, metric: '零售额' }),
  });

  out.push({
    id: 'TRD-2', category: '趋势分析', difficulty: 'L3', track: 'fact',
    question: `${c} 最近几期的零售均价是上升还是下降？`,
    expectObjectType: 'market_metric',
    judge: judgeMarketTrend({ category: c, metric: '零售均价' }),
  });

  out.push({
    id: 'TRD-3', category: '趋势分析', difficulty: 'L4', track: 'fact',
    question: `${c} 从 ${earliest} 到 ${latest}，哪个品牌的市场份额增长最快？`,
    expectObjectType: 'brand_share',
    judge: judgeGrowthLeader({ category: c, periodStart: earliest, periodEnd: latest }),
  });

  out.push({
    id: 'TRD-4', category: '趋势分析', difficulty: 'L4', track: 'fact',
    question: `${topBrand}在${c}的份额走势如何？有没有下滑趋势？`,
    expectObjectType: 'brand_share',
    judge: judgeBrandTrend({ category: c, brand: topBrand }),
  });

  if (secondCat) {
    out.push({
      id: 'TRD-5', category: '趋势分析', difficulty: 'L5', track: 'fact',
      question: `对比${c}和${secondCat}的市场规模走势，哪个品类增速更快？`,
      expectObjectType: 'market_metric',
      judge: judgeCrossCategoryTrend({ categoryA: c, categoryB: secondCat, metric: '零售额' }),
    });
  }

  return out;
}
