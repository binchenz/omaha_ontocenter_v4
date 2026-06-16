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
}

/**
 * Collect an ObjectType's renderable semantics from its storage columns
 * (`dimensions.collapsedDefault` + the type-level `semantics.universe`). Keeping
 * the "which JSONB column holds what" knowledge here — beside the renderer that
 * consumes it — means callers don't hand-stitch the input shape, and a new
 * semantics key is added in exactly one place (this fn + RenderableSemantics).
 */
export function toRenderableSemantics(objectType: {
  dimensions?: { collapsedDefault?: Record<string, string> } | null;
  semantics?: { universe?: string } | null;
}): RenderableSemantics {
  return {
    collapsedDefault: objectType.dimensions?.collapsedDefault,
    universe: objectType.semantics?.universe,
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

  return hints;
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
