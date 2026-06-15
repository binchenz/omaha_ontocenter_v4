import {
  AVC_STARS,
  toMarketMetricRawRow,
  toBrandShareRawRow,
  toModelMetricRawRow,
} from './avc-stars';

/**
 * Pins the raw-row contract (#175, ADR-0055). These externalId/property shapes must match
 * the legacy importStar path EXACTLY (brand normalization aside) so the reactive chain lands
 * identical object_instances. Rows are flat so the SyncJobWorker's identity mapping resolves.
 */
describe('AVC star registry (#175)', () => {
  it('declares 3 stars, each with its own connector type (per-star routing)', () => {
    expect(AVC_STARS).toHaveLength(3);
    const types = AVC_STARS.map((s) => s.connectorType);
    expect(new Set(types).size).toBe(3); // no shared connector → no cross-pipeline fan-out
    expect(types.sort()).toEqual(['avc_brand_excel', 'avc_market_excel', 'avc_model_excel']);
  });

  it('maps each star name to its pipeline + output ObjectType', () => {
    const byType = Object.fromEntries(AVC_STARS.map((s) => [s.objectType, s]));
    expect(byType.market_metric.pipelineName).toBe('avc_market_metric');
    expect(byType.brand_share.pipelineName).toBe('avc_brand_share');
    expect(byType.model_metric.pipelineName).toBe('avc_model_metric');
  });

  it('market_metric raw row keys by 品类_月份_指标 and is flat', () => {
    const row = toMarketMetricRawRow({ category: '电饭煲', month: '26.04', metric: '零售额', value: 100, sourceReport: 'r.xlsx' });
    expect(row.externalId).toBe('电饭煲_26.04_零售额');
    expect(row.label).toBe('电饭煲 26.04 零售额');
    // Flat: properties hoisted to top level (no nested `properties` object).
    expect(row.value).toBe(100);
    expect(row.metric).toBe('零售额');
    expect((row as any).properties).toBeUndefined();
    // year derived from month at ingest so aggregate_objects can group by year (ADR-0059).
    expect(row.year).toBe('26');
  });

  it('brand_share raw row keys by 品类_品牌_价格段_周期 and carries raw brand for later normalization', () => {
    const row = toBrandShareRawRow({ category: '电饭煲', brand: 'MIDEA', priceBand: '整体', period: '26.04', metric: 'share', value: 0.27, sourceReport: 'r.xlsx' });
    expect(row.externalId).toBe('电饭煲_MIDEA_整体_26.04');
    expect(row.brand).toBe('MIDEA'); // raw — pipeline normalize_brand step canonicalizes it downstream
    expect(row.value).toBe(0.27);
  });

  it('model_metric raw row keys by 品类_机型_月份 and carries avgPrice for price banding', () => {
    const row = toModelMetricRawRow({ category: '电饭煲', model: 'SF40', brand: '苏泊尔', heating: 'IH', launchDate: '23.10', reservation: '有', month: '26.04', valueShare: 0.02, volumeShare: 0.008, avgPrice: 709.48, sourceReport: 'r.xlsx' });
    expect(row.externalId).toBe('电饭煲_SF40_26.04');
    expect(row.avgPrice).toBe(709.48); // pipeline price_band step reads this
    expect(row.model).toBe('SF40');
  });
});
