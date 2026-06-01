import * as path from 'path';
import * as fs from 'fs';
import { AvcTemplateExtractor } from './avc-template-extractor';

const FIXTURE = path.join(__dirname, '../../../test-fixtures/avc/dianfanbao-full.xlsx');
const hasFixture = fs.existsSync(FIXTURE);
// The real AVC sample is client-private and not committed; skip (don't fail) when absent.
const d = hasFixture ? describe : describe.skip;

d('AvcTemplateExtractor — 数据报告 variant, core size metrics', () => {
  let extractor: AvcTemplateExtractor;

  beforeAll(() => {
    extractor = new AvcTemplateExtractor();
  });

  it('extracts the three core size metrics across the full month span', async () => {
    const rows = await extractor.extract(FIXTURE, '电饭煲');
    const metrics = new Set(rows.map((r) => r.metric));
    expect(metrics).toEqual(new Set(['零售额', '零售量', '零售均价']));
    // 13 monthly columns (25.04 → 26.04) × 3 metrics.
    const months = new Set(rows.map((r) => r.month));
    expect(months.size).toBe(13);
    expect(months.has('25.04')).toBe(true);
    expect(months.has('26.04')).toBe(true);
    expect(rows).toHaveLength(39);
  });

  it('reads the known 零售额 value for 25.04 from the real sample', async () => {
    const rows = await extractor.extract(FIXTURE, '电饭煲');
    const cell = rows.find((r) => r.metric === '零售额' && r.month === '25.04');
    expect(cell).toBeDefined();
    expect(cell!.value).toBeCloseTo(39205.73, 1);
  });

  it('reads the known 零售量 value for the latest month (26.04)', async () => {
    const rows = await extractor.extract(FIXTURE, '电饭煲');
    const cell = rows.find((r) => r.metric === '零售量' && r.month === '26.04');
    expect(cell!.value).toBe(1398453);
  });

  it('stamps every row with the normalized category and a source report', async () => {
    const rows = await extractor.extract(FIXTURE, '电饭煲');
    expect(rows.every((r) => r.category === '电饭煲')).toBe(true);
    expect(rows.every((r) => typeof r.sourceReport === 'string' && r.sourceReport.length > 0)).toBe(true);
  });

  it('rejects an unknown category (the unjoinable-island guard)', async () => {
    await expect(extractor.extract(FIXTURE, '扫地机器人')).rejects.toThrow();
  });
});

const ESSENCE = path.join(__dirname, '../../../test-fixtures/avc/kongqizhaguo-essence.xlsx');
const e = fs.existsSync(ESSENCE) ? describe : describe.skip;

e('AvcTemplateExtractor — 综合分析精华版 variant', () => {
  let extractor: AvcTemplateExtractor;

  beforeAll(() => {
    extractor = new AvcTemplateExtractor();
  });

  it('extracts the same three metrics across 13 months from the essence variant', async () => {
    const rows = await extractor.extract(ESSENCE, '空气炸锅');
    expect(new Set(rows.map((r) => r.metric))).toEqual(new Set(['零售额', '零售量', '零售均价']));
    expect(new Set(rows.map((r) => r.month)).size).toBe(13);
    expect(rows).toHaveLength(39);
  });

  it('reads known values despite the one-row header offset vs the full variant', async () => {
    const rows = await extractor.extract(ESSENCE, '空气炸锅');
    const retail = rows.find((r) => r.metric === '零售额' && r.month === '25.04');
    expect(retail!.value).toBeCloseTo(13951.92, 1);
    const volume = rows.find((r) => r.metric === '零售量' && r.month === '26.04');
    expect(volume!.value).toBe(632088);
  });
});

describe('AvcTemplateExtractor.detectVariant', () => {
  const extractor = new AvcTemplateExtractor();

  (fs.existsSync(FIXTURE) ? it : it.skip)('detects the full 数据报告 variant', async () => {
    expect(await extractor.detectVariant(FIXTURE)).toBe('full');
  });

  (fs.existsSync(ESSENCE) ? it : it.skip)('detects the essence 综合分析精华版 variant', async () => {
    expect(await extractor.detectVariant(ESSENCE)).toBe('essence');
  });
});

describe('AvcTemplateExtractor.extractBrandShares — 2-5 brand × price-band grid', () => {
  let extractor: AvcTemplateExtractor;
  beforeAll(() => {
    extractor = new AvcTemplateExtractor();
  });

  const fit = fs.existsSync(FIXTURE) ? it : it.skip;

  fit('reads a known brand overall share from the 整体 column', async () => {
    const rows = await extractor.extractBrandShares(FIXTURE, '电饭煲');
    const cell = rows.find((r) => r.brand === '苏泊尔' && r.priceBand === '整体');
    expect(cell!.value).toBeCloseTo(0.2685, 3);
  });

  fit('reads a known brand share within a specific price band', async () => {
    const rows = await extractor.extractBrandShares(FIXTURE, '电饭煲');
    const meidi = rows.find((r) => r.brand === '美的' && r.priceBand === '200-300');
    expect(meidi!.value).toBeCloseTo(0.07, 3);
    const xiaomi = rows.find((r) => r.brand === '小米' && r.priceBand === '400-500');
    expect(xiaomi!.value).toBeCloseTo(0.0066, 3);
  });

  fit('skips the 整体市场 total row (it is the denominator, not a brand)', async () => {
    const rows = await extractor.extractBrandShares(FIXTURE, '电饭煲');
    expect(rows.some((r) => r.brand === '整体市场')).toBe(false);
  });

  fit('stamps every row with the normalized category and emits real brands', async () => {
    const rows = await extractor.extractBrandShares(FIXTURE, '电饭煲');
    expect(rows.every((r) => r.category === '电饭煲')).toBe(true);
    const brands = new Set(rows.map((r) => r.brand));
    expect(brands.has('小米')).toBe(true);
    expect(brands.has('美的')).toBe(true);
  });

  fit('rejects an unknown category', async () => {
    await expect(extractor.extractBrandShares(FIXTURE, '扫地机器人')).rejects.toThrow();
  });
});


