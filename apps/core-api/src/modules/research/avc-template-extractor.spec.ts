import * as path from 'path';
import * as fs from 'fs';
import { AvcTemplateExtractor } from './avc-template-extractor';

// Each test reloads a ~1.2MB real AVC workbook; under full-suite parallelism the
// Excel parse exceeds jest's 5s default, so give this suite a wider budget.
jest.setTimeout(30000);

const FIXTURE = path.join(__dirname, '../../../test-fixtures/avc/dianfanbao-full.xlsx');
const hasFixture = fs.existsSync(FIXTURE);
// The real AVC sample is client-private and not committed; skip (don't fail) when absent.
const d = hasFixture ? describe : describe.skip;

d('AvcTemplateExtractor — 数据报告 variant, core size metrics', () => {
  let extractor: AvcTemplateExtractor;
  let rows: Awaited<ReturnType<AvcTemplateExtractor['extractAll']>>['metrics'];

  beforeAll(async () => {
    extractor = new AvcTemplateExtractor();
    rows = (await extractor.extractAll(FIXTURE, '电饭煲')).metrics;
  });

  it('extracts the three core size metrics across the full month span', () => {
    const metrics = new Set(rows.map((r) => r.metric));
    expect(metrics).toEqual(new Set(['零售额', '零售量', '零售均价']));
    // 13 monthly columns (25.04 → 26.04) × 3 metrics.
    const months = new Set(rows.map((r) => r.month));
    expect(months.size).toBe(13);
    expect(months.has('25.04')).toBe(true);
    expect(months.has('26.04')).toBe(true);
    expect(rows).toHaveLength(39);
  });

  it('reads the known 零售额 value for 25.04 from the real sample', () => {
    const cell = rows.find((r) => r.metric === '零售额' && r.month === '25.04');
    expect(cell).toBeDefined();
    expect(cell!.value).toBeCloseTo(39205.73, 1);
  });

  it('reads the known 零售量 value for the latest month (26.04)', () => {
    const cell = rows.find((r) => r.metric === '零售量' && r.month === '26.04');
    expect(cell!.value).toBe(1398453);
  });

  it('stamps every row with the normalized category and a source report', () => {
    expect(rows.every((r) => r.category === '电饭煲')).toBe(true);
    expect(rows.every((r) => typeof r.sourceReport === 'string' && r.sourceReport.length > 0)).toBe(true);
  });

  it('rejects an unknown category (the unjoinable-island guard)', async () => {
    await expect(extractor.extractAll(FIXTURE, '扫地机器人')).rejects.toThrow();
  });
});

const ESSENCE = path.join(__dirname, '../../../test-fixtures/avc/kongqizhaguo-essence.xlsx');
const e = fs.existsSync(ESSENCE) ? describe : describe.skip;

e('AvcTemplateExtractor — 综合分析精华版 variant', () => {
  let extractor: AvcTemplateExtractor;
  let rows: Awaited<ReturnType<AvcTemplateExtractor['extractAll']>>['metrics'];

  beforeAll(async () => {
    extractor = new AvcTemplateExtractor();
    rows = (await extractor.extractAll(ESSENCE, '空气炸锅')).metrics;
  });

  it('extracts the same three metrics across 13 months from the essence variant', () => {
    expect(new Set(rows.map((r) => r.metric))).toEqual(new Set(['零售额', '零售量', '零售均价']));
    expect(new Set(rows.map((r) => r.month)).size).toBe(13);
    expect(rows).toHaveLength(39);
  });

  it('reads known values despite the one-row header offset vs the full variant', () => {
    const retail = rows.find((r) => r.metric === '零售额' && r.month === '25.04');
    expect(retail!.value).toBeCloseTo(13951.92, 1);
    const volume = rows.find((r) => r.metric === '零售量' && r.month === '26.04');
    expect(volume!.value).toBe(632088);
  });
});

describe('AvcTemplateExtractor.extractAll — 2-5 brand × price-band grid', () => {
  let extractor: AvcTemplateExtractor;
  let rows: Awaited<ReturnType<AvcTemplateExtractor['extractAll']>>['brandShares'];

  beforeAll(async () => {
    extractor = new AvcTemplateExtractor();
    rows = hasFixture ? (await extractor.extractAll(FIXTURE, '电饭煲')).brandShares : [];
  });

  const fit = hasFixture ? it : it.skip;

  fit('reads a known brand overall share from the 整体 column', () => {
    const cell = rows.find((r) => r.brand === '苏泊尔' && r.priceBand === '整体');
    expect(cell!.value).toBeCloseTo(0.2685, 3);
  });

  fit('reads a known brand share within a specific price band', () => {
    const meidi = rows.find((r) => r.brand === '美的' && r.priceBand === '200-300');
    expect(meidi!.value).toBeCloseTo(0.07, 3);
    const xiaomi = rows.find((r) => r.brand === '小米' && r.priceBand === '400-500');
    expect(xiaomi!.value).toBeCloseTo(0.0066, 3);
  });

  fit('skips the 整体市场 total row (it is the denominator, not a brand)', () => {
    expect(rows.some((r) => r.brand === '整体市场')).toBe(false);
  });

  fit('stamps every row with the normalized category and emits real brands', () => {
    expect(rows.every((r) => r.category === '电饭煲')).toBe(true);
    const brands = new Set(rows.map((r) => r.brand));
    expect(brands.has('小米')).toBe(true);
    expect(brands.has('美的')).toBe(true);
  });

  fit('rejects an unknown category', async () => {
    await expect(extractor.extractAll(FIXTURE, '扫地机器人')).rejects.toThrow();
  });

  fit('stamps every row with the report cover month, not the constant "本期市场"', () => {
    expect(rows.every((r) => r.period === '26.04')).toBe(true);
    expect(rows.some((r) => r.period === '本期市场')).toBe(false);
  });
});

describe('AvcTemplateExtractor.extractAll — model_metric (sheet 2-7)', () => {
  const extractor = new AvcTemplateExtractor();
  let modelMetrics: Awaited<ReturnType<AvcTemplateExtractor['extractAll']>>['modelMetrics'];

  beforeAll(async () => {
    if (hasFixture) {
      modelMetrics = (await extractor.extractAll(FIXTURE, '电饭煲')).modelMetrics;
    }
  });

  (hasFixture ? it : it.skip)('extracts a known SKU with its model attributes', () => {
    const row = modelMetrics.find((r) => r.model === 'SF40HC782' && r.month === '26.04');
    expect(row).toBeDefined();
    expect(row!.brand).toBe('苏泊尔');
    expect(row!.heating).toBe('IH加热');
    expect(row!.launchDate).toBe('23.10');
    expect(row!.category).toBe('电饭煲');
  });

  (hasFixture ? it : it.skip)('reads the known per-month share and price for that SKU', () => {
    const row = modelMetrics.find((r) => r.model === 'SF40HC782' && r.month === '26.04');
    expect(row!.valueShare).toBeCloseTo(0.0200989687, 6);
    expect(row!.volumeShare).toBeCloseTo(0.0079030185, 6);
    expect(row!.avgPrice).toBeCloseTo(709.48, 1);
  });

  (hasFixture ? it : it.skip)('emits one row per month for a SKU (4 months in one report)', () => {
    const months = modelMetrics.filter((r) => r.model === 'SF40HC782').map((r) => r.month).sort();
    expect(months).toEqual(['26.01', '26.02', '26.03', '26.04']);
  });

  (hasFixture ? it : it.skip)('extracts the full TOP-100 first section, not the re-sorted later sections', () => {
    const models = new Set(modelMetrics.map((r) => r.model));
    // 2-7-1 is ~100 distinct SKUs; 4 months each. A later section re-sorts the same SKUs by
    // a different metric, so distinct-model count must stay ~100, not balloon.
    expect(models.size).toBeGreaterThan(80);
    expect(models.size).toBeLessThan(140);
  });
});

describe('AvcTemplateExtractor.extractAll — coverage detection', () => {
  const extractor = new AvcTemplateExtractor();
  let fullResult: Awaited<ReturnType<AvcTemplateExtractor['extractAll']>>;
  let essenceResult: Awaited<ReturnType<AvcTemplateExtractor['extractAll']>>;

  beforeAll(async () => {
    if (hasFixture) {
      fullResult = await extractor.extractAll(FIXTURE, '电饭煲');
    }
    if (fs.existsSync(ESSENCE)) {
      essenceResult = await extractor.extractAll(ESSENCE, '空气炸锅');
    }
  });

  (hasFixture ? it : it.skip)('reports full coverage for a 数据报告 file', () => {
    expect(fullResult.coverage).toBe('full');
  });

  (fs.existsSync(ESSENCE) ? it : it.skip)('reports essence coverage and zero model rows for a 精华版 file', () => {
    expect(essenceResult.coverage).toBe('essence');
    expect(essenceResult.modelMetrics).toEqual([]);
  });
});

// Regression (#106 follow-up): not every full-variant 2-7 sheet carries the optional
// attribute columns (加热方式/上市日期/预约功能) — 微波炉/电压力锅/电磁炉 omit them. The
// model parser must skip a missing column (colOf → 0) instead of calling getCell(0), which
// ExcelJS rejects as out-of-bounds and which aborted the WHOLE report's extraction.
describe('AvcTemplateExtractor.extractAll — 2-7 missing optional attribute columns', () => {
  const extractor = new AvcTemplateExtractor();
  const ExcelJS = require('exceljs');
  const os = require('os');

  /** Build a minimal full-variant workbook: a 2-1 size sheet + a 2-7 grid lacking 加热方式/上市日期/预约功能. */
  async function writeMinimalWorkbook(): Promise<string> {
    const wb = new ExcelJS.Workbook();

    // 2-1 size-trend: month-header row + the three core metric rows (sub-label in col E).
    const s1 = wb.addWorksheet('2-1整体市场销售规模走势');
    s1.getRow(1).getCell(6).value = '26.04';
    [['零售额', 100], ['零售量', 200], ['零售均价', 5]].forEach(([m, v], i) => {
      const row = s1.getRow(2 + i);
      row.getCell(5).value = m;
      row.getCell(6).value = v;
    });

    // 2-5 brand × price-band grid: a 分价格段...零售额 section, a band-header row (整体 + a
    // parseable band), and one brand row — enough that extractShares does not throw.
    const s5 = wb.addWorksheet('2-5主要品牌零售竞争');
    s5.getRow(1).getCell(3).value = '2-5-1分价格段品牌零售额竞争';
    const bandHeader = s5.getRow(2);
    bandHeader.getCell(4).value = '整体';
    bandHeader.getCell(5).value = '800-999';
    const brandRow = s5.getRow(3);
    brandRow.getCell(4).value = '格兰仕';
    brandRow.getCell(5).value = 0.3;

    // 2-7 grid WITHOUT the optional attribute columns: only 序号|机型|品牌, then month metrics.
    const s7 = wb.addWorksheet('2-7TOP机型明细');
    s7.getRow(1).getCell(3).value = '2-7-1本期零售额TOP100';
    const groupRow = s7.getRow(2);
    groupRow.getCell(4).value = '销额份额';
    groupRow.getCell(5).value = '销量份额';
    groupRow.getCell(6).value = '均价';
    const labelRow = s7.getRow(3);
    labelRow.getCell(1).value = '序号';
    labelRow.getCell(2).value = '机型';
    labelRow.getCell(3).value = '品牌';
    labelRow.getCell(4).value = '26.04';
    labelRow.getCell(5).value = '26.04';
    labelRow.getCell(6).value = '26.04';
    const data = s7.getRow(4);
    data.getCell(1).value = 1;
    data.getCell(2).value = 'MW-X1';
    data.getCell(3).value = '格兰仕';
    data.getCell(4).value = 0.05;
    data.getCell(5).value = 0.04;
    data.getCell(6).value = 899;

    const file = path.join(os.tmpdir(), `avc-minimal-2-7-${process.pid}.xlsx`);
    await wb.xlsx.writeFile(file);
    return file;
  }

  it('extracts model rows without throwing when optional attribute columns are absent', async () => {
    const file = await writeMinimalWorkbook();
    try {
      const out = await extractor.extractAll(file, '微波炉');
      expect(out.coverage).toBe('full');
      const sku = out.modelMetrics.find((r) => r.model === 'MW-X1');
      expect(sku).toBeDefined();
      expect(sku!.brand).toBe('格兰仕');
      expect(sku!.avgPrice).toBe(899);
      // The absent columns degrade to empty strings, not a crash.
      expect(sku!.heating).toBe('');
      expect(sku!.launchDate).toBe('');
      expect(sku!.reservation).toBe('');
    } finally {
      fs.unlinkSync(file);
    }
  });
});

// #2 (deepening): the extractor must distinguish "no model layer" (sheet 2-7 absent — the
// essence variant, a legitimate empty) from "a model layer is present but I could not parse
// it" (sheet 2-7 present but its 2-7-1 grid has no recognizable month-header row). The first
// returns []; the second must throw loudly, so an AVC re-layout surfaces as an error at ingest
// rather than as a category that silently loses its model rows.
describe('AvcTemplateExtractor.extractAll — 2-7 present but unparseable structure', () => {
  const extractor = new AvcTemplateExtractor();
  const ExcelJS = require('exceljs');
  const os = require('os');

  /** A full-variant workbook whose 2-7 sheet has a 2-7-1 title but NO YY.MM month-header row. */
  async function writeUnparseableModelSheet(): Promise<string> {
    const wb = new ExcelJS.Workbook();

    const s1 = wb.addWorksheet('2-1整体市场销售规模走势');
    s1.getRow(1).getCell(6).value = '26.04';
    [['零售额', 100], ['零售量', 200], ['零售均价', 5]].forEach(([m, v], i) => {
      const row = s1.getRow(2 + i);
      row.getCell(5).value = m;
      row.getCell(6).value = v;
    });

    const s5 = wb.addWorksheet('2-5主要品牌零售竞争');
    s5.getRow(1).getCell(3).value = '2-5-1分价格段品牌零售额竞争';
    const bandHeader = s5.getRow(2);
    bandHeader.getCell(4).value = '整体';
    bandHeader.getCell(5).value = '800-999';
    const brandRow = s5.getRow(3);
    brandRow.getCell(4).value = '格兰仕';
    brandRow.getCell(5).value = 0.3;

    // 2-7 present with a 2-7-1 section title but a malformed grid: no YY.MM month-header row,
    // so findModelLayout cannot resolve any month columns.
    const s7 = wb.addWorksheet('2-7TOP机型明细');
    s7.getRow(1).getCell(3).value = '2-7-1本期零售额TOP100';
    const labelRow = s7.getRow(2);
    labelRow.getCell(1).value = '序号';
    labelRow.getCell(2).value = '机型';
    labelRow.getCell(3).value = '品牌';
    // deliberately NO month cells anywhere

    const file = path.join(os.tmpdir(), `avc-unparseable-2-7-${process.pid}.xlsx`);
    await wb.xlsx.writeFile(file);
    return file;
  }

  it('throws naming the model sheet when 2-7 is present but its grid is unrecognizable', async () => {
    const file = await writeUnparseableModelSheet();
    try {
      await expect(extractor.extractAll(file, '微波炉')).rejects.toThrow(/2-7/);
    } finally {
      fs.unlinkSync(file);
    }
  });

  (fs.existsSync(ESSENCE) ? it : it.skip)(
    'still returns [] model rows for the essence variant (sheet 2-7 legitimately absent)',
    async () => {
      const out = await extractor.extractAll(ESSENCE, '空气炸锅');
      expect(out.coverage).toBe('essence');
      expect(out.modelMetrics).toEqual([]);
    },
  );
});


