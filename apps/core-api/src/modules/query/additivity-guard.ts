import type { Additivity, PropertySemantics } from '@omaha/shared-types';

/**
 * Per-field additivity semantics for one ObjectType, keyed by property name.
 * Only field-bearing numeric properties appear; untagged fields are absent
 * (treated as `additive` — the safe default for a plain measure).
 */
export type AdditivityMap = Map<string, PropertySemantics>;

/** The aggregate metric shape the guard inspects (a structural subset of AggregateMetric). */
export interface GuardMetric {
  kind: 'count' | 'countDistinct' | 'sum' | 'avg' | 'min' | 'max';
  field?: string;
  alias: string;
}

/**
 * The guard's verdict for one metric. The planner turns each into either SQL or
 * a structured error — the guard itself emits NO SQL and does NO IO (pure).
 *
 * - `pass`              — compile the metric as written.
 * - `rewrite-weighted`  — a ratio field aggregated with `avg`: replace the naive
 *                         `AVG(field)` with `SUM(numerator)/SUM(denominator)` over
 *                         the named sibling columns (the only correct cross-row mean).
 * - `error`             — the aggregation is semantically invalid (summing a share,
 *                         summing a ratio, or averaging a ratio whose weight columns
 *                         are not present). Carries a code + hint so the Agent recovers.
 */
export type AdditivityDecision =
  | { action: 'pass' }
  | { action: 'rewrite-weighted'; numerator: string; denominator: string }
  | {
      action: 'error';
      code: 'NON_ADDITIVE_SUM' | 'RATIO_SUM' | 'RATIO_AVG_UNWEIGHTABLE';
      field: string;
      kind: string;
      hint: string;
    };

/**
 * AdditivityGuard (ADR-0061 §1) — the one place that decides whether an aggregate
 * over a measure is semantically legal, and how a ratio mean must be weighted.
 *
 * Deep module: a small pure interface — `(metric, map, isNumeric) → decision` —
 * behind the full additivity ruleset. The planner injects it before building the
 * metric SQL; isolating it here keeps the rule out of the SQL string-builder and
 * makes every branch unit-testable without a database.
 *
 * @param metric    the aggregate metric being planned
 * @param map       per-field semantics for this ObjectType (undefined → all additive)
 * @param isNumeric predicate: is this column a numeric field on the (visible) view?
 *                  Used to confirm a ratio's weight columns actually exist before
 *                  emitting a weighted-division rewrite.
 */
export function planMetricAdditivity(
  metric: GuardMetric,
  map: AdditivityMap | undefined,
  isNumeric: (field: string) => boolean,
): AdditivityDecision {
  // count(*) and any field-less metric carry no measure semantics.
  if (!metric.field) return { action: 'pass' };
  // countDistinct / min / max never combine magnitudes across rows, so they are
  // always safe regardless of additivity. Only sum/avg can misrepresent a measure.
  if (metric.kind !== 'sum' && metric.kind !== 'avg') return { action: 'pass' };

  const semantics = map?.get(metric.field);
  const additivity: Additivity | undefined = semantics?.kind;
  // Untagged or explicitly additive → ordinary SUM/AVG is correct.
  if (!additivity || additivity === 'additive') return { action: 'pass' };

  if (additivity === 'non-additive') {
    if (metric.kind === 'sum') {
      return {
        action: 'error',
        code: 'NON_ADDITIVE_SUM',
        field: metric.field,
        kind: metric.kind,
        hint: `'${metric.field}' 是不可加字段（如份额/占比），跨维度 SUM 无意义。改用 min/max 看极值，或对构成它的可加基量（如零售额）求和后再算占比。`,
      };
    }
    // avg of a share is a weak signal but not a wrong-number trap → allow.
    return { action: 'pass' };
  }

  // additivity === 'ratio'
  if (metric.kind === 'sum') {
    return {
      action: 'error',
      code: 'RATIO_SUM',
      field: metric.field,
      kind: metric.kind,
      hint: `'${metric.field}' 是比率字段（如均价），不可相加。求跨维度均价请用加权口径（Σ分子÷Σ分母），或用 min/max 看区间。`,
    };
  }
  // avg of a ratio: rewrite to a weighted division iff both sibling columns exist.
  const ratioOf = semantics?.ratioOf;
  if (ratioOf && isNumeric(ratioOf.numerator) && isNumeric(ratioOf.denominator)) {
    return { action: 'rewrite-weighted', numerator: ratioOf.numerator, denominator: ratioOf.denominator };
  }
  // No resolvable weight columns (e.g. AVC long-format where 均价 is a sibling ROW,
  // not a sibling column). Emit a structured error rather than a wrong simple mean.
  return {
    action: 'error',
    code: 'RATIO_AVG_UNWEIGHTABLE',
    field: metric.field,
    kind: metric.kind,
    hint: `'${metric.field}' 是比率字段，简单平均会失真，且其加权所需的分子/分母列不在同一行内。请改为：先对可加基量分组求和，再在结果上相除得到加权均价。`,
  };
}
