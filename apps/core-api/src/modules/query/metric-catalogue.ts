import type { Additivity } from '@omaha/shared-types';

/**
 * Metric Catalogue (ADR-0064 §4) — a declarative named metric carrying ALL its
 * semantics in one place: physical source (star + the metric filter that pins it),
 * caliber (unit / additivity / universe), time axis, display, and natural-language
 * synonyms. This is the "select a metric" layer that replaces "compose a query":
 * the LLM picks a name from the controlled vocabulary, and the engine
 * deterministically resolves it to a query (resolve → bind → aggregate → envelope).
 *
 * HITL design (slice ④, signed off 2026-06-19): storage = standalone TS module
 * (this file), resolution = pure resolveMetric + bind, selection = the
 * `query_metric` tool. Built ON TOP OF the ADR-0017 aggregate primitive, never
 * bypassing it. Explicitly NOT a dimension-entity star (ADR-0061/0042 Alt-B holds):
 * it makes semantics VISIBLE declaratively; it does not model dimensions as joins.
 */

/** How a metric value is aggregated across the rows the engine fetches. */
export type MetricAggKind = 'sum' | 'avg' | 'min' | 'max';

export interface MetricDef {
  /** Canonical metric name (e.g. '零售额') — the primary key of the catalogue. */
  name: string;
  /** The source star this metric physically lives on (e.g. 'market_metric'). */
  star: string;
  /**
   * The filter that pins this metric within the star. For a LONG-format star
   * (market_metric / brand_share) this is `{ field:'metric', value:'零售额' }`.
   * Absent for a WIDE-format star where the field itself is the metric.
   */
  metricFilter?: { field: string; value: string };
  /** The numeric column the aggregate runs over (e.g. 'value', 'valueShare'). */
  valueField: string;
  /** The default aggregation for this metric (additive→sum, ratio→avg with weighted rewrite). */
  defaultAgg: MetricAggKind;
  /** Display unit (e.g. '万元', '万台', '元', '%'). Drives MeasureFormatter. */
  unit: string;
  /** ADR-0061 §1 additivity caliber. */
  additivity: Additivity;
  /** ADR-0061 §2 sampling universe of the source star, when declared. */
  universe?: string;
  /** ADR-0064 §1: the series-axis field on the star (e.g. 'month' / 'period'). */
  timeAxisField?: string;
  /**
   * The dimensions that key a SINGLE source row for this metric, excluding the
   * metricFilter and any auto-defaulted dimension (priceBand→整体). Used to refuse a
   * ratio/non-additive query whose scope spans multiple rows (a naive AVG/MAX would
   * silently mis-blend): every keyDimension must be pinned (a filter) or grouped.
   * Additive metrics ignore this (a cross-row SUM is valid). See validateMetricScope.
   */
  keyDimensions: string[];
  /** Natural-language synonyms that resolve to this same metric (销额/GMV → 零售额). */
  synonyms: string[];
}

/**
 * The AVC metric catalogue. Slice ④ proved the mechanism with the 零售额 tracer;
 * slice ⑤ (#251) populates the full AVC measure set + synonyms on this same
 * mechanism — content/config, no new machinery. Each entry's caliber (additivity)
 * is the SAME fact the ADR-0061 AdditivityGuard enforces at the SQL layer, declared
 * here once so the LLM selects a metric that is already correctly calibrated.
 */
export const AVC_METRIC_CATALOGUE: readonly MetricDef[] = [
  {
    name: '零售额',
    star: 'market_metric',
    metricFilter: { field: 'metric', value: '零售额' },
    valueField: 'value',
    defaultAgg: 'sum',
    unit: '万元',
    additivity: 'additive',
    universe: 'whole-market',
    timeAxisField: 'month',
    keyDimensions: ['category', 'month'],
    synonyms: ['销额', 'GMV', '卖了多少钱', '零售金额', '销售额'],
  },
  {
    name: '零售量',
    star: 'market_metric',
    metricFilter: { field: 'metric', value: '零售量' },
    valueField: 'value',
    defaultAgg: 'sum',
    unit: '万台',
    additivity: 'additive',
    universe: 'whole-market',
    timeAxisField: 'month',
    keyDimensions: ['category', 'month'],
    synonyms: ['销量', '卖了多少台', '零售台数', '销售量', '台量'],
  },
  {
    name: '零售均价',
    star: 'market_metric',
    metricFilter: { field: 'metric', value: '零售均价' },
    valueField: 'value',
    // ratio caliber. market_metric's shared `value` column is UNTAGGED at the property
    // level (the long-format額/量/均价 reality, see the DEF comment), so the SQL-layer
    // AdditivityGuard — which keys on the column — CANNOT catch a cross-period naive
    // AVG here. The catalogue closes that gap itself: validateMetricScope (below)
    // refuses a ratio query whose scope spans >1 source row (keyDimensions not all
    // pinned/grouped), so a year-scoped 均价 is rejected with a Σ额÷Σ量 steer rather
    // than silently returning an unweighted mean. A single pinned month is one row → exact.
    defaultAgg: 'avg',
    unit: '元',
    additivity: 'ratio',
    universe: 'whole-market',
    timeAxisField: 'month',
    keyDimensions: ['category', 'month'],
    synonyms: ['均价', '平均价格', '单价', '客单价'],
  },
  {
    name: '份额',
    star: 'brand_share',
    metricFilter: { field: 'metric', value: 'share' },
    valueField: 'value',
    // non-additive: a single (category, brand, priceBand, period) is ONE row. `max` is a
    // safe single-row read, but MAX over MULTIPLE brand rows would silently return the
    // largest brand's share mislabeled as the category's. The SQL guard waves max through
    // (min/max are always "safe"), so the catalogue enforces scope itself:
    // validateMetricScope refuses a 份额 query unless `brand` is pinned or grouped
    // (priceBand auto-defaults to 整体, so it is not a keyDimension here).
    defaultAgg: 'max',
    unit: '%',
    additivity: 'non-additive',
    universe: 'whole-market',
    timeAxisField: 'period',
    keyDimensions: ['category', 'brand', 'period'],
    synonyms: ['市场份额', '占比', '市占率', '份额占比', '市占'],
  },
];
