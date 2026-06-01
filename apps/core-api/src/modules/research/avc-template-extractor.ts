import * as path from 'path';
import ExcelJS from 'exceljs';
import { normalizeCategory } from '@omaha/shared-types';

/** One extracted market-metric datapoint: a metric value for a category in a given month. */
export interface MarketMetricRow {
  category: string;
  month: string;
  metric: string;
  value: number;
  sourceReport: string;
}

/** The size-trend sheet present in every AVC monthly report (both variants). */
const SIZE_TREND_SHEET = '2-1整体市场销售规模走势';
/** A sheet present only in the full 数据报告 variant, absent from the 综合分析精华版. */
const FULL_VARIANT_SHEET = '2-7TOP机型明细';
/** The three core size metrics; their row is identified by this label in the sub-label column. */
const CORE_METRICS = ['零售额', '零售量', '零售均价'];
const MONTH_PATTERN = /^\d\d\.\d\d$/;

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
