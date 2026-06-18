import { BadRequestException } from '@nestjs/common';
import { resolveMetric, bind, validateMetricScope, type MetricSelection } from './metric-resolver';
import { AVC_METRIC_CATALOGUE, type MetricDef } from './metric-catalogue';

/**
 * ADR-0064 §4: the Metric Catalogue's pure resolve→bind path. resolveMetric maps a
 * name OR synonym to its entry; bind turns the selection into a concrete
 * AggregateObjectsRequest above the ADR-0017 primitive. Table-driven, DB-free —
 * the highest-value tests of the "select a metric" contract.
 */
describe('resolveMetric', () => {
  it('resolves the canonical tracer name 零售额 to the market_metric entry', () => {
    const r = resolveMetric('零售额');
    expect(r).not.toBeNull();
    expect(r!.entry.name).toBe('零售额');
    expect(r!.entry.star).toBe('market_metric');
    expect(r!.matchedOn).toBe('零售额');
  });

  it('resolves synonyms 销额 / GMV / 卖了多少钱 to the same 零售额 entry', () => {
    for (const syn of ['销额', 'GMV', '卖了多少钱']) {
      const r = resolveMetric(syn);
      expect(r!.entry.name).toBe('零售额');
      expect(r!.matchedOn).toBe(syn);
    }
  });

  it('is case-insensitive and trims whitespace (gmv → GMV → 零售额)', () => {
    expect(resolveMetric('  gmv ')!.entry.name).toBe('零售额');
  });

  it('returns null for an off-catalogue metric (caller falls back to the DSL path)', () => {
    expect(resolveMetric('利润率')).toBeNull();
    expect(resolveMetric('')).toBeNull();
  });

  it('prefers a canonical name over any synonym shadowing it', () => {
    const catalogue: MetricDef[] = [
      { name: 'A', star: 's1', valueField: 'value', defaultAgg: 'sum', unit: '', additivity: 'additive', keyDimensions: [], synonyms: ['x'] },
      { name: 'B', star: 's2', valueField: 'value', defaultAgg: 'sum', unit: '', additivity: 'additive', keyDimensions: [], synonyms: ['A'] }, // synonym 'A' must NOT win over the real name A
    ];
    expect(resolveMetric('A', catalogue)!.entry.name).toBe('A');
  });
});

describe('bind', () => {
  const retail = AVC_METRIC_CATALOGUE.find((m) => m.name === '零售额')!;

  it('binds a lookup to a pinned aggregate on the right star (metric pin + dims + time)', () => {
    const sel: MetricSelection = { metric: '零售额', dimensions: { category: '电饭煲' }, time: { month: '26.04' }, intent: 'lookup' };
    const req = bind(retail, sel);
    expect(req.objectType).toBe('market_metric');
    expect(req.groupBy).toEqual([]); // a single scalar — no grouping
    expect(req.metrics).toEqual([{ kind: 'sum', field: 'value', alias: '零售额' }]);
    // metric pin + dimension + time all present as eq filters
    expect(req.filters).toContainEqual({ field: 'metric', operator: 'eq', value: '零售额' });
    expect(req.filters).toContainEqual({ field: 'category', operator: 'eq', value: '电饭煲' });
    expect(req.filters).toContainEqual({ field: 'month', operator: 'eq', value: '26.04' });
  });

  it('binds a trend to a groupBy on the star timeAxis field (month), leaving the axis open', () => {
    const sel: MetricSelection = { metric: '零售额', dimensions: { category: '电饭煲' }, intent: 'trend' };
    const req = bind(retail, sel);
    expect(req.groupBy).toEqual(['month']);
    // no month eq filter — the axis is grouped, not pinned
    expect(req.filters!.some((f) => f.field === 'month')).toBe(false);
    expect(req.filters).toContainEqual({ field: 'metric', operator: 'eq', value: '零售额' });
  });

  it('binds a rank to a groupBy on rankBy with a desc metric orderBy', () => {
    const sel: MetricSelection = { metric: '零售额', dimensions: { category: '电饭煲' }, intent: 'rank', rankBy: 'brand' };
    const req = bind(retail, sel);
    expect(req.groupBy).toEqual(['brand']);
    expect(req.orderBy).toEqual([{ kind: 'metric', by: '零售额', direction: 'desc' }]);
  });

  it('always pins the long-format metric filter so the额 row is isolated', () => {
    const req = bind(retail, { metric: '零售额' });
    expect(req.filters).toContainEqual({ field: 'metric', operator: 'eq', value: '零售额' });
  });
});

/**
 * ADR-0064 — the scope guard the adversarial review surfaced: a ratio/non-additive
 * metric aggregated across >1 source row would silently mis-blend (the SQL guard can't
 * catch it on the long-format/min-max path). validateMetricScope refuses it with a steer.
 */
describe('validateMetricScope (ratio / non-additive cross-row refusal)', () => {
  const avgPrice = AVC_METRIC_CATALOGUE.find((m) => m.name === '零售均价')!;
  const share = AVC_METRIC_CATALOGUE.find((m) => m.name === '份额')!;
  const retail = AVC_METRIC_CATALOGUE.find((m) => m.name === '零售额')!;

  it('REJECTS a year-scoped 零售均价 lookup (month not pinned → unweighted cross-month mean)', () => {
    expect(() => bind(avgPrice, { metric: '零售均价', dimensions: { category: '电饭煲' }, time: { year: '25' }, intent: 'lookup' }))
      .toThrow(BadRequestException);
    try {
      bind(avgPrice, { metric: '零售均价', dimensions: { category: '电饭煲' }, time: { year: '25' }, intent: 'lookup' });
    } catch (e: any) {
      expect(e.getResponse().error.code).toBe('RATIO_SCOPE_UNPINNED');
      expect(e.getResponse().error.hint).toMatch(/两步法|Σ额÷Σ量|加权/);
    }
  });

  it('ALLOWS a single-month 零售均价 lookup (one row → exact)', () => {
    expect(() => bind(avgPrice, { metric: '零售均价', dimensions: { category: '电饭煲' }, time: { month: '26.04' }, intent: 'lookup' })).not.toThrow();
  });

  it('ALLOWS a 零售均价 trend (groupBy month covers the month keyDimension)', () => {
    expect(() => bind(avgPrice, { metric: '零售均价', dimensions: { category: '电饭煲' }, intent: 'trend' })).not.toThrow();
  });

  it('REJECTS a 份额 lookup with no brand (max over all brands = wrong, mislabeled)', () => {
    expect(() => bind(share, { metric: '份额', dimensions: { category: '电饭煲' }, time: { period: '25.12' }, intent: 'lookup' }))
      .toThrow(BadRequestException);
    try {
      bind(share, { metric: '份额', dimensions: { category: '电饭煲' }, time: { period: '25.12' }, intent: 'lookup' });
    } catch (e: any) {
      expect(e.getResponse().error.code).toBe('NON_ADDITIVE_SCOPE_UNPINNED');
      expect(e.getResponse().error.field).toContain('brand');
    }
  });

  it('ALLOWS a 份额 lookup with brand pinned (single row)', () => {
    expect(() => bind(share, { metric: '份额', dimensions: { category: '电饭煲', brand: '小米' }, time: { period: '25.12' }, intent: 'lookup' })).not.toThrow();
  });

  it('ALLOWS a 份额 rank (groupBy brand covers the brand keyDimension)', () => {
    expect(() => bind(share, { metric: '份额', dimensions: { category: '电饭煲' }, time: { period: '25.12' }, intent: 'rank', rankBy: 'brand' })).not.toThrow();
  });

  it('NEVER refuses an additive metric across rows (a cross-period SUM is valid)', () => {
    expect(() => validateMetricScope(retail, { metric: '零售额', dimensions: { category: '电饭煲' }, time: { year: '25' } }, [])).not.toThrow();
  });
});
