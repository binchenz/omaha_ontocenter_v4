import { OntologySdk } from '../ontology.sdk';

/**
 * ADR-0061 §3: getTypeDetail surfaces folded-dimension semantics as Agent-readable
 * hints (via SemanticsRenderer), so the schema replaces the skill prose that used
 * to warn against reverse-asserting "no priceBand data". Tier-0 menu unchanged
 * (existence-never-truncated, ADR-0050) — hints ride only in the Tier-1 detail.
 */
function makeSdk(types: any[]) {
  const ontologyService = {
    listObjectTypes: jest.fn().mockResolvedValue(types),
    listRelationships: jest.fn().mockResolvedValue([]),
  };
  const typeResolver = { invalidate: jest.fn() };
  const prisma: any = { actionDefinition: { findMany: jest.fn().mockResolvedValue([]) } };
  return new OntologySdk(ontologyService as any, typeResolver as any, prisma);
}

const BRAND_SHARE = {
  name: 'brand_share',
  label: '品牌份额',
  description: 'AVC 分价格段品牌份额',
  properties: [
    { name: 'category', type: 'string', label: '品类', filterable: true },
    { name: 'priceBand', type: 'string', label: '价格段', filterable: true },
    { name: 'value', type: 'number', label: '份额' },
  ],
  derivedProperties: [],
  dimensions: { required: ['category', 'period'], defaults: { priceBand: '整体' }, collapsedDefault: { priceBand: '整体' } },
};

describe('OntologySdk — folded-dimension semantics in getTypeDetail (ADR-0061)', () => {
  it('attaches a semanticsHints array carrying the folded-dimension warning', async () => {
    const sdk = makeSdk([BRAND_SHARE]);
    const detail = await sdk.getTypeDetail('t1', 'brand_share');
    const target = detail.types[0] as any;
    expect(Array.isArray(target.semanticsHints)).toBe(true);
    const joined = target.semanticsHints.join('\n');
    expect(joined).toContain('priceBand');
    expect(joined).toMatch(/折叠/);
    expect(joined).toMatch(/groupBy|钻取/);
    expect(joined).toMatch(/勿|不要|始终存在/);
  });

  it('omits semanticsHints (or empty) for a type with no folded dimensions or universe', async () => {
    const plain = { ...BRAND_SHARE, name: 'market_metric', dimensions: { required: ['category', 'month'], defaults: {} }, semantics: {} };
    const sdk = makeSdk([plain]);
    const detail = await sdk.getTypeDetail('t1', 'market_metric');
    const hints = (detail.types[0] as any).semanticsHints ?? [];
    expect(hints).toEqual([]);
  });

  it('surfaces a top-sample universe warning for model_metric (ADR-0061 §2)', async () => {
    const model = {
      name: 'model_metric', label: 'TOP机型', description: 'AVC 2-7',
      properties: [{ name: 'valueShare', type: 'number', label: '销额份额' }],
      derivedProperties: [],
      dimensions: { required: ['category', 'month'], defaults: {} },
      semantics: { universe: 'top-sample' },
    };
    const sdk = makeSdk([model]);
    const detail = await sdk.getTypeDetail('t1', 'model_metric');
    const joined = ((detail.types[0] as any).semanticsHints ?? []).join('\n');
    expect(joined).toMatch(/TOP|样本|非全市场/);
    expect(joined).toContain('brand_share');
  });

  it('surfaces the monthly-continuous timeAxis cadence for market_metric (ADR-0064 §1)', async () => {
    const market = {
      name: 'market_metric', label: '市场指标', description: 'AVC 2-1',
      properties: [{ name: 'value', type: 'number', label: '数值' }],
      derivedProperties: [],
      dimensions: { required: ['category', 'month'], defaults: {} },
      semantics: { universe: 'whole-market', timeAxis: { field: 'month', grain: 'month', format: 'YY.MM（26.04=2026年4月）', density: 'dense' } },
    };
    const sdk = makeSdk([market]);
    const detail = await sdk.getTypeDetail('t1', 'market_metric');
    const joined = ((detail.types[0] as any).semanticsHints ?? []).join('\n');
    // The Agent can read the cadence from the schema without any skill prose.
    expect(joined).toMatch(/月度连续|连续/);
    expect(joined).toContain('month');
    expect(joined).toMatch(/反推|互推|别的星/); // and the cross-star reverse-inference ban
  });
});
