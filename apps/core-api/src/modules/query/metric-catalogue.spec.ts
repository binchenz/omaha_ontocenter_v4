import { resolveMetric, bind } from './metric-resolver';
import { AVC_METRIC_CATALOGUE } from './metric-catalogue';

/**
 * ADR-0064 §5 (#251): the full AVC metric set + synonyms. Phrasing-invariant recall
 * — distinct wordings of one intent resolve to the same catalogue metric — and each
 * metric carries the correct caliber (零售均价=ratio, 份额=non-additive). Content
 * tests on the slice-④ mechanism; asserts observable selection, not classifier internals.
 */
describe('AVC metric catalogue — full set (ADR-0064 §5)', () => {
  it('seeds the four AVC measures on their correct source stars', () => {
    const byName = new Map(AVC_METRIC_CATALOGUE.map((m) => [m.name, m]));
    expect(byName.get('零售额')!.star).toBe('market_metric');
    expect(byName.get('零售量')!.star).toBe('market_metric');
    expect(byName.get('零售均价')!.star).toBe('market_metric');
    expect(byName.get('份额')!.star).toBe('brand_share');
  });

  describe('phrasing-invariant recall (synonyms → same metric)', () => {
    const cases: Array<[string[], string]> = [
      [['零售额', '销额', 'GMV', '卖了多少钱', '销售额'], '零售额'],
      [['零售量', '销量', '卖了多少台', '销售量'], '零售量'],
      [['零售均价', '均价', '平均价格', '单价', '客单价'], '零售均价'],
      [['份额', '市场份额', '占比', '市占率', '市占'], '份额'],
    ];
    for (const [phrasings, canonical] of cases) {
      it(`maps ${phrasings.join(' / ')} → ${canonical}`, () => {
        for (const p of phrasings) {
          const r = resolveMetric(p);
          expect(r).not.toBeNull();
          expect(r!.entry.name).toBe(canonical);
        }
      });
    }
  });

  describe('correct caliber on each metric', () => {
    it('零售额 / 零售量 are additive (sum-able)', () => {
      expect(resolveMetric('零售额')!.entry.additivity).toBe('additive');
      expect(resolveMetric('零售量')!.entry.additivity).toBe('additive');
    });

    it('零售均价 is a ratio (defaultAgg avg, never sum)', () => {
      const e = resolveMetric('均价')!.entry;
      expect(e.additivity).toBe('ratio');
      expect(e.defaultAgg).toBe('avg');
      expect(e.unit).toBe('元');
    });

    it('份额 is non-additive (defaultAgg max so a single-row lookup never sums shares)', () => {
      const e = resolveMetric('占比')!.entry;
      expect(e.additivity).toBe('non-additive');
      expect(e.defaultAgg).toBe('max');
      expect(e.unit).toBe('%');
    });
  });

  describe('binding targets the correct star + pins the metric per caliber', () => {
    it('零售量 lookup → market_metric sum on value, metric=零售量 pinned', () => {
      const req = bind(resolveMetric('销量')!.entry, { metric: '销量', dimensions: { category: '电饭煲' }, time: { month: '26.04' } });
      expect(req.objectType).toBe('market_metric');
      expect(req.metrics).toEqual([{ kind: 'sum', field: 'value', alias: '零售量' }]);
      expect(req.filters).toContainEqual({ field: 'metric', operator: 'eq', value: '零售量' });
    });

    it('零售均价 single-month lookup → market_metric avg(value) (one row → exact; cross-period is refused by validateMetricScope)', () => {
      const req = bind(resolveMetric('均价')!.entry, { metric: '均价', dimensions: { category: '电饭煲' }, time: { month: '26.04' } });
      expect(req.metrics).toEqual([{ kind: 'avg', field: 'value', alias: '零售均价' }]);
    });

    it('份额 lookup → brand_share max on value, metric=share pinned (never a cross-row SUM)', () => {
      const req = bind(resolveMetric('市场份额')!.entry, { metric: '市场份额', dimensions: { category: '电饭煲', brand: '小米' }, time: { period: '26.04' } });
      expect(req.objectType).toBe('brand_share');
      expect(req.metrics).toEqual([{ kind: 'max', field: 'value', alias: '份额' }]);
      expect(req.filters).toContainEqual({ field: 'metric', operator: 'eq', value: 'share' });
    });

    it('a 份额 trend groups by the brand_share period axis', () => {
      const req = bind(resolveMetric('份额')!.entry, { metric: '份额', dimensions: { category: '电饭煲', brand: '小米' }, intent: 'trend' });
      expect(req.groupBy).toEqual(['period']);
    });
  });
});
