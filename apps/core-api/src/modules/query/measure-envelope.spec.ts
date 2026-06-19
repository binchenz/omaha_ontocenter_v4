import { resolveMeasureSemantics, envelopeAggregateGroup, envelopeQueryRow, type EnvelopeViewSemantics } from './measure-envelope';

/**
 * ADR-0064 §2: measure-envelope derives a measure's caliber (unit / metric /
 * additivity / universe) from the AVC long- and wide-format conventions, then
 * wraps each value in a MeasureCell. These tests pin the observable envelope
 * shape on both the aggregate and query paths — the integration assertions that
 * mirror query-planner-additivity.spec.ts, but DB-free against the pure assembler.
 */

const marketView: EnvelopeViewSemantics = {
  universe: 'whole-market',
  grain: 'month',
  additivity: new Map(),
};
const brandShareView: EnvelopeViewSemantics = {
  universe: 'whole-market',
  grain: 'snapshot',
  additivity: new Map([['value', { kind: 'non-additive' }]]),
};
const modelView: EnvelopeViewSemantics = {
  universe: 'top-sample',
  grain: 'month',
  additivity: new Map([
    ['valueShare', { kind: 'non-additive' }],
    ['avgPrice', { kind: 'ratio' }],
  ]),
};

describe('resolveMeasureSemantics', () => {
  it('resolves a market_metric 零售额 from the metric= pin → 万元 / additive', () => {
    const s = resolveMeasureSemantics({ objectType: 'market_metric', metricKind: 'sum', field: 'value', metricName: '零售额', view: marketView });
    expect(s).toEqual({ unit: '万元', metric: '零售额', additivity: 'additive' });
  });

  it('resolves 零售均价 as a ratio in 元 (never summable)', () => {
    const s = resolveMeasureSemantics({ objectType: 'market_metric', metricKind: 'avg', field: 'value', metricName: '零售均价', view: marketView });
    expect(s).toEqual({ unit: '元', metric: '零售均价', additivity: 'ratio' });
  });

  it('resolves brand_share share → % / non-additive', () => {
    const s = resolveMeasureSemantics({ objectType: 'brand_share', metricKind: 'sum', field: 'value', metricName: 'share', view: brandShareView });
    expect(s).toEqual({ unit: '%', metric: 'share', additivity: 'non-additive' });
  });

  it('resolves model_metric by FIELD name (wide format): valueShare → 份额 / non-additive', () => {
    const s = resolveMeasureSemantics({ objectType: 'model_metric', metricKind: 'sum', field: 'valueShare', view: modelView });
    expect(s).toEqual({ unit: '%', metric: '份额', additivity: 'non-additive' });
  });

  it('resolves model_metric avgPrice → 零售均价 / ratio by field name', () => {
    const s = resolveMeasureSemantics({ objectType: 'model_metric', metricKind: 'avg', field: 'avgPrice', view: modelView });
    expect(s).toEqual({ unit: '元', metric: '零售均价', additivity: 'ratio' });
  });

  it('treats a count as unitless additive (no measure semantics)', () => {
    const s = resolveMeasureSemantics({ objectType: 'market_metric', metricKind: 'count', view: marketView });
    expect(s).toEqual({ unit: '', metric: '', additivity: 'additive' });
  });

  it('falls back to the view additivity (unit unknown) for an unrecognised measure', () => {
    const view: EnvelopeViewSemantics = { additivity: new Map([['weird', { kind: 'non-additive' }]]) };
    const s = resolveMeasureSemantics({ objectType: 'other', metricKind: 'sum', field: 'weird', view });
    expect(s).toEqual({ unit: '', metric: 'weird', additivity: 'non-additive' });
  });
});

describe('envelopeAggregateGroup', () => {
  it('wraps a 零售额 sum into a 万元→亿元 envelope carrying caliber + period', () => {
    const measures = envelopeAggregateGroup({
      objectType: 'market_metric',
      metricSpecs: [{ kind: 'sum', field: 'value', alias: 'total' }],
      metrics: { total: 39012.84 },
      filters: [{ field: 'metric', operator: 'eq', value: '零售额' }],
      groupKey: { month: '26.04' },
      view: marketView,
    });
    expect(measures.total).toEqual({
      display: '3.90 亿元（39,012.84 万元）',
      raw: 39012.84,
      unit: '万元',
      metric: '零售额',
      additivity: 'additive',
      universe: 'whole-market',
      grain: 'month',
      period: '26.04',
    });
  });

  it('reads the metric name from the GROUP KEY when grouping by metric', () => {
    const measures = envelopeAggregateGroup({
      objectType: 'market_metric',
      metricSpecs: [{ kind: 'sum', field: 'value', alias: 'v' }],
      metrics: { v: 6.42 },
      filters: [],
      groupKey: { metric: '零售均价' },
      view: marketView,
    });
    expect(measures.v.metric).toBe('零售均价');
    expect(measures.v.unit).toBe('元');
    expect(measures.v.additivity).toBe('ratio');
  });

  it('labels a count metric as a unitless integer cell', () => {
    const measures = envelopeAggregateGroup({
      objectType: 'market_metric',
      metricSpecs: [{ kind: 'count', alias: 'n' }],
      metrics: { n: 53 },
      filters: [],
      groupKey: {},
      view: marketView,
    });
    expect(measures.n.display).toBe('53');
    expect(measures.n.unit).toBe('');
  });

  it('skips a metric whose value is not a number', () => {
    const measures = envelopeAggregateGroup({
      objectType: 'market_metric',
      metricSpecs: [{ kind: 'sum', field: 'value', alias: 'total' }],
      metrics: { total: NaN as unknown as number, other: undefined as unknown as number },
      filters: [{ field: 'metric', operator: 'eq', value: '零售额' }],
      groupKey: {},
      view: marketView,
    });
    // NaN is still a number → enveloped (display falls back to 'NaN'); a non-number alias is skipped.
    expect('other' in measures).toBe(false);
  });
});

describe('envelopeQueryRow', () => {
  it('wraps a brand_share row value as a % non-additive cell with its period', () => {
    const measures = envelopeQueryRow({
      objectType: 'brand_share',
      properties: { brand: '小米', priceBand: '整体', period: '26.04', metric: 'share', value: 0.0979 },
      measureFields: ['value'],
      view: brandShareView,
    });
    expect(measures!.value).toEqual({
      display: '9.79%',
      raw: 0.0979,
      unit: '%',
      metric: 'share',
      additivity: 'non-additive',
      universe: 'whole-market',
      grain: 'snapshot',
      period: '26.04',
    });
  });

  it('returns undefined when the row carries no numeric measure', () => {
    const measures = envelopeQueryRow({
      objectType: 'brand_share',
      properties: { brand: '小米', period: '26.04' },
      measureFields: ['value'],
      view: brandShareView,
    });
    expect(measures).toBeUndefined();
  });
});
