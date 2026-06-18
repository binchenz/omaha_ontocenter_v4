/**
 * The structural semantics one ObjectType carries that the Agent must be TOLD
 * about (ADR-0061). Kept intentionally small — each field maps to exactly one
 * class of hint line. `universe` is consumed in #191; declared here so the
 * renderer is the single seam both slices extend.
 */
export interface RenderableSemantics {
  /**
   * ADR-0061 §3 (extends ADR-0057): dimensions that exist but are folded to a
   * default value unless the query drills in. Keyed by dimension → default value.
   */
  collapsedDefault?: Record<string, string>;
  /** ADR-0061 §2: sampling universe of the star (e.g. 'top-sample' / 'whole-market'). #191. */
  universe?: string;
  /** ADR-0064 §1: the star's temporal sampling frame (series axis, grain, density, format). */
  timeAxis?: TimeAxisHint;
}

interface TimeAxisHint {
  field: string;
  grain: 'month' | 'quarter' | 'year' | 'snapshot';
  format?: string;
  density: 'dense' | 'sparse';
}

/**
 * Collect an ObjectType's renderable semantics from its storage columns
 * (`dimensions.collapsedDefault` + the type-level `semantics.universe` /
 * `semantics.timeAxis`). Keeping the "which JSONB column holds what" knowledge
 * here — beside the renderer that consumes it — means callers don't hand-stitch
 * the input shape, and a new semantics key is added in exactly one place (this
 * fn + RenderableSemantics).
 */
export function toRenderableSemantics(objectType: {
  dimensions?: { collapsedDefault?: Record<string, string> } | null;
  semantics?: { universe?: string; timeAxis?: unknown } | null;
}): RenderableSemantics {
  return {
    collapsedDefault: objectType.dimensions?.collapsedDefault,
    universe: objectType.semantics?.universe,
    // Validate the raw JSONB shape here (mirrors the loader's parseSemantics): an
    // out-of-enum grain/density yields undefined (zero weight), so a malformed row
    // can never interpolate `undefined` into a hint line.
    timeAxis: parseTimeAxisHint(objectType.semantics?.timeAxis),
  };
}

const TIME_GRAINS = new Set(['month', 'quarter', 'year', 'snapshot']);
const TIME_DENSITIES = new Set(['dense', 'sparse']);

/** Validate raw JSONB into a TimeAxisHint, or undefined if the shape is not recognised. */
function parseTimeAxisHint(raw: unknown): TimeAxisHint | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const t = raw as Record<string, unknown>;
  if (typeof t.field !== 'string') return undefined;
  if (typeof t.grain !== 'string' || !TIME_GRAINS.has(t.grain)) return undefined;
  if (typeof t.density !== 'string' || !TIME_DENSITIES.has(t.density)) return undefined;
  return {
    field: t.field,
    grain: t.grain as TimeAxisHint['grain'],
    density: t.density as TimeAxisHint['density'],
    ...(typeof t.format === 'string' ? { format: t.format } : {}),
  };
}

/**
 * SemanticsRenderer (ADR-0061 §3) — turns an ObjectType's structural semantics
 * into Agent-readable hint lines that the schema detail (Tier-1) carries. This is
 * the structural replacement for the skill prose that used to encode these rules;
 * lifting it here means any surface that reads the schema inherits the semantics,
 * and the rules can no longer drift from the ontology that owns them.
 *
 * Pure deep module: `semantics → string[]`, no IO, every branch unit-testable.
 * Returns [] when nothing is declared so a plain type adds zero prompt weight.
 */
export function renderSemanticsHints(semantics: RenderableSemantics): string[] {
  const hints: string[] = [];

  // Folded dimensions: the root-cause fix for dimension-default-blindspot — the
  // Agent must know the dimension EXISTS, is collapsed, and must not be reverse-
  // asserted as "no data". One line per folded dimension.
  for (const [dim, def] of Object.entries(semantics.collapsedDefault ?? {})) {
    hints.push(
      `维度 ${dim} 默认折叠为「${def}」：不带 ${dim} 过滤时系统自动注入 ${dim}=${def}（聚合口径），` +
        `你只会看到该默认值的行。分${dim}数据始终存在，须显式 groupBy [${dim}] 或加 ${dim} 过滤才能钻取；` +
        `勿因默认只见「${def}」就反向断言「无${dim}数据」。`,
    );
  }

  // Sampling universe (ADR-0061 §2): the Agent must not conflate stars from
  // different universes — a TOP-sample SKU roll-up is NOT the official share.
  hints.push(...renderUniverse(semantics.universe));

  // Time axis (ADR-0064 §1): tell the Agent the star's cadence so it stops
  // GUESSING grain (BUG-2 half 1). Pins the read of a value (format) and — for a
  // dense series — instructs it to probe THIS star's real periods, never reverse-
  // infer coverage from a sibling star's report periods.
  hints.push(...renderTimeAxis(semantics.timeAxis));

  return hints;
}

/** TimeAxis → hint line(s). Absent → nothing (zero prompt weight, like universe). */
function renderTimeAxis(timeAxis: TimeAxisHint | undefined): string[] {
  if (!timeAxis) return [];
  const fmt = timeAxis.format ? `，读法 ${timeAxis.format}` : '';
  if (timeAxis.density === 'dense') {
    return [
      `时间轴 \`${timeAxis.field}\`（${grainLabel(timeAxis.grain)}连续序列${fmt}）：这是一条连续的${grainLabel(timeAxis.grain)}序列。` +
        `画趋势/算环比前，先用 aggregate 探出本星实际有哪些 ${timeAxis.field}，按探到的期次作图；` +
        `**绝不要拿别的星（如 brand_share/avc_report 的稀疏年度报告期）反推本星的覆盖或缺失**——各星覆盖独立，不可互推。`,
    ];
  }
  return [
    `时间轴 \`${timeAxis.field}\`（${grainLabel(timeAxis.grain)}稀疏快照${fmt}）：这是按报告产生的稀疏快照，不是连续序列。` +
      `不要把它当连续趋势逐期外推，也不要用它的报告期去推断别的星的月度覆盖。`,
  ];
}

/** Human label for a grain, used in the hint line. Total — never returns undefined. */
function grainLabel(grain: TimeAxisHint['grain']): string {
  switch (grain) {
    case 'month': return '月度';
    case 'quarter': return '季度';
    case 'year': return '年度';
    case 'snapshot': return '快照';
    default: return '周期';
  }
}

/** Universe → hint line. Unknown / absent values produce nothing (no noise). */
function renderUniverse(universe: string | undefined): string[] {
  if (universe === 'top-sample') {
    return [
      `抽样宇宙：TOP 样本（非全市场口径）。本星是头部 SKU 样本，将其份额汇总得到的品牌份额` +
        `不等于官方全市场份额；引用官方品牌份额请以 brand_share（全市场口径）为准，差异属预期，须注明口径。`,
    ];
  }
  if (universe === 'whole-market') {
    return [`抽样宇宙：全市场口径。可作为官方份额/规模引用，不要用 TOP 样本星的汇总值替代它。`];
  }
  return [];
}
