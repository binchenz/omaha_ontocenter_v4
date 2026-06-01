import * as path from 'path';
import ExcelJS from 'exceljs';
import { normalizeCategory, parsePriceBand } from '@omaha/shared-types';

/** One extracted market-metric datapoint: a metric value for a category in a given month. */
export interface MarketMetricRow {
  category: string;
  month: string;
  metric: string;
  value: number;
  sourceReport: string;
}

/** One brand's retail share within a price band, for the current period. */
export interface BrandShareRow {
  category: string;
  brand: string;
  /** Price-band label as it appears in the report (e.g. '整体', '200-300', '≥4000'). */
  priceBand: string;
  period: string;
  metric: string;
  value: number;
  sourceReport: string;
}

/** The size-trend sheet present in every AVC monthly report (both variants). */
const SIZE_TREND_SHEET = '2-1整体市场销售规模走势';
/** The brand × price-band competition sheet. */
const BRAND_COMPETITION_SHEET = '2-5主要品牌零售竞争';
/** A sheet present only in the full 数据报告 variant, absent from the 综合分析精华版. */
const FULL_VARIANT_SHEET = '2-7TOP机型明细';
/** The three core size metrics; their row is identified by this label in the sub-label column. */
const CORE_METRICS = ['零售额', '零售量', '零售均价'];
const MONTH_PATTERN = /^\d\d\.\d\d$/;
const SECTION_TITLE_PATTERN = /^2-5-\d/;
/** Column D holds the brand name in the 2-5 grid. */
const BRAND_COLUMN = 4;
/** The total row (the share denominator), not a brand — skipped. */
const TOTAL_ROW_LABEL = '整体市场';
/** The header label for the all-bands-combined column. */
const WHOLE_MARKET_BAND = '整体';

/** Which of the two known AVC layouts a file uses. */
export type AvcVariant = 'full' | 'essence';

/**
 * Extracts clean market-metric rows from an AVC monthly monitoring spreadsheet (ADR-0042 §4).
 * The AVC xlsx is a heavy analyst cross-tab, not tabular data, so the generic FileParserService
 * yields garbage on it; this is the bounded template adapter for the known AVC layout.
 *
 * Deliberately offset-agnostic: it locates the month-header row by matching the `YY.MM` cell
 * pattern rather than hardcoding a row number, and reads the metric name from the sub-label
 * column. The two AVC variants (数据报告 / 综合分析精华版) differ only by a one-row offset, so
 * the same code handles both.
 */
export class AvcTemplateExtractor {
  async extract(filePath: string, rawCategory: string): Promise<MarketMetricRow[]> {
    const category = normalizeCategory(rawCategory);
    if (!category) {
      // The unjoinable-island guard (ADR-0042 §3): an unknown 品类 cannot join to anything.
      throw new Error(`Unknown 品类 "${rawCategory}" — not in the category vocabulary.`);
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const sheet = workbook.getWorksheet(SIZE_TREND_SHEET);
    if (!sheet) {
      throw new Error(`AVC sheet "${SIZE_TREND_SHEET}" not found in ${path.basename(filePath)}.`);
    }

    const monthColumns = this.findMonthColumns(sheet);
    if (monthColumns.length === 0) {
      throw new Error(`No month columns found in "${SIZE_TREND_SHEET}" — unrecognized layout.`);
    }

    const sourceReport = path.basename(filePath);
    const rows: MarketMetricRow[] = [];
    sheet.eachRow((row) => {
      const subLabel = this.cellText(row.getCell(5).value); // col E: per-row metric sub-label
      if (!CORE_METRICS.includes(subLabel)) return;
      for (const { col, month } of monthColumns) {
        const value = this.numericValue(row.getCell(col).value);
        if (value !== null) {
          rows.push({ category, month, metric: subLabel, value, sourceReport });
        }
      }
    });
    return rows;
  }

  /**
   * Detect which of the two known AVC layouts a file uses. The full 数据报告 carries the
   * TOP-机型 / platform-breakdown sheets that the 综合分析精华版 strips out, so their
   * presence distinguishes the variants. Extraction itself is offset-agnostic and does not
   * need the variant, but ingestion records it and an unrecognized layout fails loudly.
   */
  async detectVariant(filePath: string): Promise<AvcVariant> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    if (!workbook.getWorksheet(SIZE_TREND_SHEET)) {
      throw new Error(
        `Unrecognized AVC layout in ${path.basename(filePath)}: missing "${SIZE_TREND_SHEET}".`,
      );
    }
    return workbook.getWorksheet(FULL_VARIANT_SHEET) ? 'full' : 'essence';
  }

  /**
   * Extract the brand × price-band retail-share grid (ADR-0042 §4, sheet 2-5). The sheet
   * stacks many sub-sections (分价格段 / 分加热方式 / …), each with two horizontal blocks
   * (本期市场 / 本年累计); this reads only the first 分价格段...零售额 section and its current-
   * period block. Anchored on the section title and the band-header row (located by its
   * price-band cells), not hardcoded coordinates, so it survives the variant row offsets.
   */
  async extractBrandShares(filePath: string, rawCategory: string): Promise<BrandShareRow[]> {
    const category = normalizeCategory(rawCategory);
    if (!category) {
      throw new Error(`Unknown 品类 "${rawCategory}" — not in the category vocabulary.`);
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const sheet = workbook.getWorksheet(BRAND_COMPETITION_SHEET);
    if (!sheet) {
      throw new Error(`AVC sheet "${BRAND_COMPETITION_SHEET}" not found in ${path.basename(filePath)}.`);
    }

    const sectionRow = this.findPriceBandSectionRow(sheet);
    if (!sectionRow) {
      throw new Error(`No 分价格段...零售额 section found in "${BRAND_COMPETITION_SHEET}" — unrecognized layout.`);
    }

    // The band-header row is the first row after the section title that carries band columns.
    let headerRow = 0;
    let bandColumns: Array<{ col: number; band: string }> = [];
    for (let r = sectionRow + 1; r <= sheet.rowCount; r++) {
      const cols = this.findBandColumns(sheet.getRow(r));
      if (cols.length >= 2) {
        headerRow = r;
        bandColumns = cols;
        break;
      }
    }
    if (!headerRow) {
      throw new Error(`No price-band header row found under the 分价格段 section in ${path.basename(filePath)}.`);
    }

    const sourceReport = path.basename(filePath);
    const rows: BrandShareRow[] = [];
    for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
      const title = this.cellText(sheet.getRow(r).getCell(3).value);
      if (SECTION_TITLE_PATTERN.test(title)) break; // reached the next sub-section
      const brand = this.cellText(sheet.getRow(r).getCell(BRAND_COLUMN).value);
      if (!brand || brand === TOTAL_ROW_LABEL) continue; // 整体市场 is the denominator, not a brand
      for (const { col, band } of bandColumns) {
        const value = this.numericValue(sheet.getRow(r).getCell(col).value);
        if (value !== null) {
          rows.push({ category, brand, priceBand: band, period: '本期市场', metric: 'share', value, sourceReport });
        }
      }
    }
    return rows;
  }

  /** Find the first 分价格段...零售额 section title row (col C). */
  private findPriceBandSectionRow(sheet: ExcelJS.Worksheet): number {
    for (let r = 1; r <= sheet.rowCount; r++) {
      const title = this.cellText(sheet.getRow(r).getCell(3).value);
      if (SECTION_TITLE_PATTERN.test(title) && title.includes('分价格段') && title.includes('零售额')) {
        return r;
      }
    }
    return 0;
  }

  /**
   * Band columns of the current-period (本期市场) block: the 整体 column plus each parseable
   * price band, stopping at the second 整体 (which begins the 本年累计 block).
   */
  private findBandColumns(row: ExcelJS.Row): Array<{ col: number; band: string }> {
    const candidates: Array<{ col: number; band: string }> = [];
    row.eachCell((cell, col) => {
      const text = this.cellText(cell.value);
      if (text === WHOLE_MARKET_BAND || parsePriceBand(text) !== null) {
        candidates.push({ col, band: text });
      }
    });
    candidates.sort((a, b) => a.col - b.col);
    const result: Array<{ col: number; band: string }> = [];
    let wholeMarketSeen = 0;
    for (const c of candidates) {
      if (c.band === WHOLE_MARKET_BAND && ++wholeMarketSeen === 2) break;
      result.push(c);
    }
    return result;
  }

  private findMonthColumns(sheet: ExcelJS.Worksheet): Array<{ col: number; month: string }> {
    let best: Array<{ col: number; month: string }> = [];
    sheet.eachRow((row) => {
      const found: Array<{ col: number; month: string }> = [];
      row.eachCell((cell, col) => {
        const text = this.cellText(cell.value);
        if (MONTH_PATTERN.test(text)) found.push({ col, month: text });
      });
      if (found.length > best.length) best = found;
    });
    return best;
  }

  private cellText(value: ExcelJS.CellValue): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object' && 'result' in value) return String(value.result ?? '').trim();
    return String(value).trim();
  }

  private numericValue(value: ExcelJS.CellValue): number | null {
    if (typeof value === 'number') return value;
    if (value && typeof value === 'object' && 'result' in value && typeof value.result === 'number') {
      return value.result;
    }
    return null;
  }
}
