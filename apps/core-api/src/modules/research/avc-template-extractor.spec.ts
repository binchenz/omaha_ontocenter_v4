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
