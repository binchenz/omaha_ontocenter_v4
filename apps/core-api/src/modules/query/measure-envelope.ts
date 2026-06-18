import type { Additivity, MeasureCell, QueryFilter } from '@omaha/shared-types';
import { toMeasureCell, type MeasureFormatHints } from './measure-formatter';

/**
 * measure-envelope (ADR-0064 §2) — derives the semantic hints (unit / metric /
 * additivity) for a measure value, then wraps it in a `MeasureCell`. This is the
 * one place query/aggregate results acquire their envelope, so both `query_objects`
 * and `aggregate_objects` inherit it with no per-tool code.
 *
 * The unit/metric derivation is BEST-EFFORT in this slice: it reads the AVC
 * long-format `metric=` pin (零售额/零售量/零售均价/share) and the model_metric
 * wide-format field names. The authoritative source becomes the Metric Catalogue
 * (slices ④/⑤); this declarative table is its precursor. additivity/universe come
 * straight from the ADR-0061 view fields, so the caliber rides on the data.
 *
 * Pure: no DB, no IO. The caller passes the view-derived semantics in.
 */

/** The minimal view facts the envelope reads (a structural subset of OntologyView). */
export interface EnvelopeViewSemantics {
  /** ADR-0061 §1 per-field additivity, keyed by property name. */
  additivity?: Map<string, { kind: Additivity; ratioOf?: { numerator: string; denominator: string } }>;
  /** ADR-0061 §2 sampling universe of the star. */
  universe?: string;
  /** ADR-0064 §1 time grain of the star (the design-intent cadence). */
  grain?: string;
}

/** AVC measure semantics, keyed by the resolved metric name. The catalogue precursor. */
const AVC_MEASURE_SEMANTICS: Readonly<Record<string, { unit: string; additivity: Additivity }>> = {
  零售额: { unit: '万元', additivity: 'additive' },
  零售量: { unit: '万台', additivity: 'additive' },
  零售均价: { unit: '元', additivity: 'ratio' },
  份额: { unit: '%', additivity: 'non-additive' },
  share: { unit: '%', additivity: 'non-additive' },
};

/** model_metric is wide-format: the FIELD name is the metric. Maps field → resolved metric name. */
const MODEL_METRIC_FIELDS: Readonly<Record<string, string>> = {
  valueShare: '份额',
  volumeShare: '份额',
  avgPrice: '零售均价',
};

/** Pull the value of an `eq` filter on `field`, if present (the long-format metric pin). */
function eqFilterValue(filters: QueryFilter[] | undefined, field: string): string | undefined {
  const f = filters?.find((x) => x.field === field && x.operator === 'eq');
  return typeof f?.value === 'string' ? f.value : undefined;
}

/**
 * The semantics for a single measure: which metric it is, its unit, and its
 * additivity. Resolution order, most-specific first:
 *  1. model_metric wide-format field name → metric.
 *  2. an explicit `metricName` (a long-format `metric=` pin or a row's metric value).
 *  3. the view's per-field additivity (ADR-0061), unit unknown.
 *  4. plain additive, unitless (a count, or a non-AVC measure).
 */
export function resolveMeasureSemantics(args: {
  objectType: string;
  /** The aggregate metric kind, when this came from aggregate_objects. */
  metricKind?: 'count' | 'countDistinct' | 'sum' | 'avg' | 'min' | 'max';
  /** The underlying measure field (sum/avg field, or a row's property name). */
  field?: string;
  /** A resolved metric name — a long-format `metric=` pin or a row's `metric` value. */
  metricName?: string;
  view?: EnvelopeViewSemantics;
}): { unit: string; metric: string; additivity: Additivity } {
  const { objectType, metricKind, field, metricName, view } = args;

  // A count never carries measure semantics — it is a unitless additive tally.
  if (metricKind === 'count' || metricKind === 'countDistinct') {
    return { unit: '', metric: metricName ?? field ?? '', additivity: 'additive' };
  }

  // model_metric: the field name IS the metric (wide format).
  if (objectType === 'model_metric' && field && MODEL_METRIC_FIELDS[field]) {
    const resolved = MODEL_METRIC_FIELDS[field];
    const sem = AVC_MEASURE_SEMANTICS[resolved];
    return { unit: sem.unit, metric: resolved, additivity: sem.additivity };
  }

  // market_metric / brand_share: the `metric=` pin (or row metric value) is the metric.
  if (metricName && AVC_MEASURE_SEMANTICS[metricName]) {
    const sem = AVC_MEASURE_SEMANTICS[metricName];
    return { unit: sem.unit, metric: metricName, additivity: sem.additivity };
  }

  // Fall back to the view's declared additivity for the field (ADR-0061), unit unknown.
  const fieldAdd = field ? view?.additivity?.get(field)?.kind : undefined;
  return { unit: '', metric: metricName ?? field ?? '', additivity: fieldAdd ?? 'additive' };
}

/**
 * Build the `measures` envelope for ONE aggregate group's metric map. Returns a
 * parallel `Record<alias, MeasureCell>` to ride beside the raw numeric `metrics`.
 */
export function envelopeAggregateGroup(args: {
  objectType: string;
  metricSpecs: Array<{ kind: 'count' | 'countDistinct' | 'sum' | 'avg' | 'min' | 'max'; field?: string; alias: string }>;
  metrics: Record<string, number>;
  filters?: QueryFilter[];
  groupKey: Record<string, unknown>;
  view?: EnvelopeViewSemantics;
}): Record<string, MeasureCell> {
  const { objectType, metricSpecs, metrics, filters, groupKey, view } = args;
  // The metric name can be pinned by a filter (long-format) OR be the group key
  // (when the query groups BY `metric`). The group key wins — it is row-specific.
  const pinnedMetric = eqFilterValue(filters, 'metric');
  const keyedMetric = typeof groupKey.metric === 'string' ? (groupKey.metric as string) : undefined;
  const period =
    (typeof groupKey.month === 'string' && groupKey.month) ||
    (typeof groupKey.period === 'string' && groupKey.period) ||
    undefined;

  const out: Record<string, MeasureCell> = {};
  for (const spec of metricSpecs) {
    const raw = metrics[spec.alias];
    if (typeof raw !== 'number') continue;
    const sem = resolveMeasureSemantics({
      objectType,
      metricKind: spec.kind,
      field: spec.field,
      metricName: keyedMetric ?? pinnedMetric,
      view,
    });
    const hints: MeasureFormatHints = {
      unit: sem.unit,
      metric: sem.metric || spec.alias,
      additivity: sem.additivity,
      universe: view?.universe,
      grain: view?.grain,
      period,
    };
    out[spec.alias] = toMeasureCell(raw, hints);
  }
  return out;
}

/**
 * Build the `measures` envelope for ONE query_objects row's numeric MEASURE
 * fields. A field counts as a measure if the view tags it numeric AND it is not a
 * dimension/time key. For the AVC long-format stars the metric name comes from the
 * row's own `metric` property.
 */
export function envelopeQueryRow(args: {
  objectType: string;
  properties: Record<string, unknown>;
  measureFields: string[];
  view?: EnvelopeViewSemantics;
}): Record<string, MeasureCell> | undefined {
  const { objectType, properties, measureFields, view } = args;
  const rowMetric = typeof properties.metric === 'string' ? (properties.metric as string) : undefined;
  const period =
    (typeof properties.month === 'string' && properties.month) ||
    (typeof properties.period === 'string' && properties.period) ||
    undefined;

  const out: Record<string, MeasureCell> = {};
  for (const field of measureFields) {
    const raw = properties[field];
    if (typeof raw !== 'number') continue;
    const sem = resolveMeasureSemantics({
      objectType,
      field,
      metricName: rowMetric,
      view,
    });
    const hints: MeasureFormatHints = {
      unit: sem.unit,
      metric: sem.metric || field,
      additivity: sem.additivity,
      universe: view?.universe,
      grain: view?.grain,
      period,
    };
    out[field] = toMeasureCell(raw, hints);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
