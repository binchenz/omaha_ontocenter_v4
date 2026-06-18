import { BadRequestException } from '@nestjs/common';
import type { QueryFilter } from '@omaha/shared-types';
import { AVC_METRIC_CATALOGUE, type MetricDef, type MetricAggKind } from './metric-catalogue';
import type { AggregateObjectsRequest } from './query.service';

/**
 * The intent of a metric query — narrows how the binder shapes the aggregate:
 *  - `lookup` : a single scalar for a pinned (category, time) — no time grouping.
 *  - `trend`  : a series over the time axis — group by the star's timeAxis field.
 *  - `rank`   : a ranking over a breakdown dimension — group by that dimension.
 */
export type MetricIntent = 'lookup' | 'trend' | 'rank';

export interface MetricSelection {
  /** A catalogue metric name OR one of its synonyms. */
  metric: string;
  /** Dimension filters as plain key→value (e.g. { category: '电饭煲' }). */
  dimensions?: Record<string, string>;
  /** Time selection: a single period (lookup) — keyed by the star's axis or 'month'/'period'/'year'. */
  time?: Record<string, string>;
  /** What kind of answer is wanted (default 'lookup'). */
  intent?: MetricIntent;
  /** For intent='rank', the dimension to break down / rank by (e.g. 'brand'). */
  rankBy?: string;
}

export interface ResolveResult {
  entry: MetricDef;
  /** Which token matched (the canonical name or a synonym) — surfaced for observability. */
  matchedOn: string;
}

/**
 * resolveMetric (ADR-0064 §4) — map a name OR synonym to its catalogue entry.
 * Pure, table-testable. Case-insensitive and whitespace-trimmed; canonical names
 * take precedence over synonyms. Returns null for an unknown metric (the caller
 * falls back to the guard-railed DSL path — the two-tier design).
 */
export function resolveMetric(
  name: string,
  catalogue: readonly MetricDef[] = AVC_METRIC_CATALOGUE,
): ResolveResult | null {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  // Canonical-name match first (a name must never be shadowed by another's synonym).
  for (const entry of catalogue) {
    if (entry.name.toLowerCase() === needle) return { entry, matchedOn: entry.name };
  }
  for (const entry of catalogue) {
    const syn = entry.synonyms.find((s) => s.toLowerCase() === needle);
    if (syn) return { entry, matchedOn: syn };
  }
  return null;
}

/**
 * bind (ADR-0064 §4) — turn a resolved metric + a selection into a concrete
 * `AggregateObjectsRequest` for the ADR-0017 aggregate primitive. Pure: it only
 * assembles the request; QueryService executes it and attaches the slice-① envelope.
 *
 * The metric's caliber decides nothing here beyond the aggregate KIND default
 * (additive→sum, ratio→avg — the planner's AdditivityGuard then enforces the
 * weighted rewrite / rejection). The metricFilter pins the long-format metric row.
 */
export function bind(entry: MetricDef, selection: MetricSelection): AggregateObjectsRequest {
  const intent = selection.intent ?? 'lookup';
  const groupBy = resolveGroupBy(entry, intent, selection.rankBy);

  // Refuse a ratio/non-additive metric whose scope spans >1 source row BEFORE binding:
  // the SQL guard cannot catch it (the long-format `value` column is untagged / min-max
  // is "always safe"), so a naive AVG/MAX would silently mis-blend. Additive metrics skip
  // this — a cross-row SUM is valid.
  validateMetricScope(entry, selection, groupBy);

  const filters: QueryFilter[] = [];

  // 1. Pin the metric within its star (long-format stars only).
  if (entry.metricFilter) {
    filters.push({ field: entry.metricFilter.field, operator: 'eq', value: entry.metricFilter.value });
  }
  // 2. Dimension filters (category, brand, priceBand, …).
  for (const [field, value] of Object.entries(selection.dimensions ?? {})) {
    filters.push({ field, operator: 'eq', value });
  }
  // 3. Time filters (a pinned period for lookup; trend leaves the axis open to group).
  for (const [field, value] of Object.entries(selection.time ?? {})) {
    filters.push({ field, operator: 'eq', value });
  }

  const kind: MetricAggKind = entry.defaultAgg;

  return {
    objectType: entry.star,
    filters,
    groupBy,
    metrics: [{ kind, field: entry.valueField, alias: entry.name }],
    // A trend/rank wants the natural ordering; lookup is a single group.
    orderBy: intent === 'rank' && selection.rankBy
      ? [{ kind: 'metric', by: entry.name, direction: 'desc' }]
      : undefined,
  };
}

/**
 * Guard a ratio/non-additive metric against a scope that spans multiple source rows.
 * Every keyDimension must be PINNED (a filter in dimensions or time) or GROUPED (in the
 * resolved groupBy). If any is loose, a naive AVG/MAX over the spanned rows would be a
 * silent wrong number (an unweighted ratio mean, or the largest of several shares), and
 * the SQL AdditivityGuard cannot catch it on this path — so refuse with a structured
 * steer. Additive metrics are exempt (a cross-row SUM is the correct, intended behavior).
 */
export function validateMetricScope(entry: MetricDef, selection: MetricSelection, groupBy: string[]): void {
  if (entry.additivity === 'additive') return;
  const pinned = new Set<string>([...Object.keys(selection.dimensions ?? {}), ...Object.keys(selection.time ?? {})]);
  const grouped = new Set<string>(groupBy);
  const loose = entry.keyDimensions.filter((d) => !pinned.has(d) && !grouped.has(d));
  if (loose.length === 0) return;

  const isRatio = entry.additivity === 'ratio';
  throw new BadRequestException({
    error: {
      code: isRatio ? 'RATIO_SCOPE_UNPINNED' : 'NON_ADDITIVE_SCOPE_UNPINNED',
      message: `'${entry.name}' 是${isRatio ? '比率' : '不可加'}指标，当前查询跨多行（${loose.join('、')} 未限定），直接 ${entry.defaultAgg.toUpperCase()} 会算错。`,
      metric: entry.name,
      field: loose,
      hint: isRatio
        ? `请把 ${loose.join('、')} 固定到单期（如 month=YY.MM）再取单点均价；跨期均价请改用两步法：分别取零售额合计与零售量合计后相除（Σ额÷Σ量，销量加权），不要对均价行直接平均。`
        : `请指定 ${loose.join('、')}（如 brand=某品牌）取单项${entry.name}，或用 intent=rank + rankBy=${loose[0]} 看排名；不要把多行${entry.name} 直接取 ${entry.defaultAgg}。`,
    },
  });
}

/** Decide the groupBy for the intent: trend → time axis; rank → rankBy; lookup → none. */
function resolveGroupBy(entry: MetricDef, intent: MetricIntent, rankBy?: string): string[] {
  if (intent === 'trend' && entry.timeAxisField) return [entry.timeAxisField];
  if (intent === 'rank' && rankBy) return [rankBy];
  return [];
}
