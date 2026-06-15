import * as path from 'path';
import ExcelJS from 'exceljs';
import { requireCategory, normalizeCategory, parsePriceBand } from '@omaha/shared-types';

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

/**
 * One TOP-100 model/SKU datapoint for a category in a given month (AVC sheet 2-7).
 * The finest-grain star object (ADR-0043): a SKU's monthly share + its own 零售均价 (for
 * query-time price-band attribution) + 上市日期 (for derived new-entrant judgement).
 */
export interface ModelMetricRow {
  category: string;
  model: string;
  brand: string;
  heating: string;
  launchDate: string;
  reservation: string;
  month: string;
  valueShare: number;
  volumeShare: number;
  avgPrice: number;
  sourceReport: string;
}

/** The table-of-contents sheet; its R1 title declares the report's 品类 (ADR-0058). */
const TOC_SHEET = '目录';
/** The 品类 is the 2nd dash-token of the 目录 title `《AVC-<品类>-线上…报告》`. */
const TOC_TITLE_PATTERN = /AVC-([^-]+)-/;
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
/** The 2-7 sub-section we read: 本期零售额 TOP100. Sections 2-7-2..4 re-sort the same SKUs. */
const MODEL_SECTION_PATTERN = /^2-7-1/;
/** Any 2-7 sub-section title — marks the end of the rows we read. */
const MODEL_NEXT_SECTION_PATTERN = /^2-7-\d/;
/** Field labels in the 2-7 model grid's header row. */
const MODEL_LABEL = '机型';
const BRAND_LABEL = '品牌';
const HEATING_LABEL = '加热方式';
const LAUNCH_LABEL = '上市日期';
const RESERVATION_LABEL = '预约功能';
/** Column D holds the brand name in the 2-5 grid. */
const BRAND_COLUMN = 4;
/** Column E holds the per-row metric sub-label in the 2-1 sheet. */
const METRIC_SUBLABEL_COLUMN = 5;
/** Column C holds the section title in the 2-5 sheet. */
const SECTION_TITLE_COLUMN = 3;
/** The total row (the share denominator), not a brand — skipped. */
const TOTAL_ROW_LABEL = '整体市场';
/** The header label for the all-bands-combined column. */
const WHOLE_MARKET_BAND = '整体';

/** Which of the two known AVC layouts a file uses. */
export type AvcVariant = 'full' | 'essence';

/** Pattern to extract YY.MM period from real AVC filenames like `…（26.04）.xlsx`. */
const FILENAME_PERIOD_PATTERN = /[（(](\d{2}\.\d{2})[）)]/;

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
  /**
   * The single public entry: parse one AVC workbook into all of its fact layers — market
   * metrics (2-1), brand × price-band shares (2-5), TOP-100 model rows (2-7) — plus the
   * report's cover month and coverage variant, from ONE workbook load (ADR-0043). Per-sheet
   * parsing is internal: a caller expresses one intent ("extract this report") and never
   * names which sheet a fact comes from, so the whole AVC layout stays behind this seam.
   * An unrecognized layout (no 2-1 sheet) throws loudly via extractMetrics.
   */
  async extractAll(
    filePath: string,
    assertedCategory?: string,
  ): Promise<{ category: string; metrics: MarketMetricRow[]; brandShares: BrandShareRow[]; modelMetrics: ModelMetricRow[]; coverage: AvcVariant; period: string; sourceReport: string }> {
    const workbook = await this.load(filePath);
    const sourceReport = path.basename(filePath);
    // ADR-0058: the file's 目录 title is the source of truth for 品类. When present (every real
    // AVC file has it), it overrides any caller assertion — a positional script bug can no longer
    // mislabel data. A caller-supplied category is kept only as a fail-fast cross-check: if it
    // disagrees with the file, throw rather than silently store rows under the wrong category.
    const declared = this.readDeclaredCategory(workbook);
    let category: string;
    if (declared) {
      category = declared;
      if (assertedCategory) {
        const asserted = requireCategory(assertedCategory);
        if (asserted !== declared) {
          throw new Error(
            `Category mismatch in ${sourceReport}: caller asserted "${asserted}" but the file's 目录 declares "${declared}".`,
          );
        }
      }
    } else {
      // No 目录 sheet (hand-built test workbooks): fall back to the caller's assertion.
      if (!assertedCategory) {
        throw new Error(`Cannot determine 品类 for ${sourceReport}: no 目录 title and no caller-asserted category.`);
      }
      category = requireCategory(assertedCategory);
    }
    const period = this.readCoverMonth(workbook, sourceReport);
    const coverage: AvcVariant = workbook.getWorksheet(FULL_VARIANT_SHEET) ? 'full' : 'essence';
    return {
      category,
      metrics: this.extractMetrics(workbook, category, sourceReport),
      brandShares: this.extractShares(workbook, category, sourceReport, period),
      modelMetrics: this.extractModels(workbook, category, sourceReport),
      coverage,
      period,
      sourceReport,
    };
  }

  private async load(filePath: string): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    return workbook;
  }

  private extractMetrics(workbook: ExcelJS.Workbook, category: string, sourceReport: string): MarketMetricRow[] {
    const sheet = workbook.getWorksheet(SIZE_TREND_SHEET);
    if (!sheet) {
      throw new Error(`AVC sheet "${SIZE_TREND_SHEET}" not found in ${sourceReport}.`);
    }

    const monthColumns = this.findMonthColumns(sheet);
    if (monthColumns.length === 0) {
      throw new Error(`No month columns found in "${SIZE_TREND_SHEET}" — unrecognized layout.`);
    }

    const rows: MarketMetricRow[] = [];
    sheet.eachRow((row) => {
      const subLabel = this.cellText(row.getCell(METRIC_SUBLABEL_COLUMN).value);
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
   * Extract the brand × price-band retail-share grid (ADR-0042 §4, sheet 2-5). The sheet
   * stacks many sub-sections (分价格段 / 分加热方式 / …), each with two horizontal blocks
   * (本期市场 / 本年累计); this reads only the first 分价格段...零售额 section and its current-
   * period block. Anchored on the section title and the band-header row (located by its
   * price-band cells), not hardcoded coordinates, so it survives the variant row offsets.
   */
  private extractShares(workbook: ExcelJS.Workbook, category: string, sourceReport: string, period: string): BrandShareRow[] {
    const sheet = workbook.getWorksheet(BRAND_COMPETITION_SHEET);
    if (!sheet) {
      throw new Error(`AVC sheet "${BRAND_COMPETITION_SHEET}" not found in ${sourceReport}.`);
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
      throw new Error(`No price-band header row found under the 分价格段 section in ${sourceReport}.`);
    }

    const rows: BrandShareRow[] = [];
    for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const title = this.cellText(row.getCell(SECTION_TITLE_COLUMN).value);
      if (SECTION_TITLE_PATTERN.test(title)) break; // reached the next sub-section
      const brand = this.cellText(row.getCell(BRAND_COLUMN).value);
      if (!brand || brand === TOTAL_ROW_LABEL) continue; // 整体市场 is the denominator, not a brand
      for (const { col, band } of bandColumns) {
        const value = this.numericValue(row.getCell(col).value);
        if (value !== null) {
          rows.push({ category, brand, priceBand: band, period, metric: 'share', value, sourceReport });
        }
      }
    }
    return rows;
  }

  /**
   * Derive the report's cover month (YY.MM). Primary: parse `（YY.MM）` from the filename.
   * Fallback: the latest month column in the 2-1 size-trend sheet (always present).
   */
  /**
   * Derive the report's canonical 品类 from the 目录 sheet's R1 title (`《AVC-<品类>-线上…报告》`),
   * folded through normalizeCategory so AVC's renamed/aliased names land on the canonical key
   * (ADR-0058). Returns null when the sheet/title is absent (hand-built test workbooks) so the
   * caller can fall back to an asserted category. Throws when a title is present but its 品类 is
   * not in the vocabulary — a loud failure beats silently storing an unjoinable category.
   */
  private readDeclaredCategory(workbook: ExcelJS.Workbook): string | null {
    const sheet = workbook.getWorksheet(TOC_SHEET);
    if (!sheet) return null;
    const row = sheet.getRow(1);
    let title = '';
    for (let col = 1; col <= 8; col++) {
      const text = this.cellText(row.getCell(col).value);
      if (text.includes('AVC')) { title = text; break; }
    }
    const m = TOC_TITLE_PATTERN.exec(title);
    if (!m) return null;
    const canonical = normalizeCategory(m[1]);
    if (!canonical) {
      throw new Error(`Cannot derive 品类 from 目录 title "${title}": "${m[1]}" is not in the category vocabulary.`);
    }
    return canonical;
  }

  private readCoverMonth(workbook: ExcelJS.Workbook, sourceReport: string): string {
    const m = FILENAME_PERIOD_PATTERN.exec(sourceReport);
    if (m) return m[1];
    const sheet = workbook.getWorksheet(SIZE_TREND_SHEET);
    const cols = sheet ? this.findMonthColumns(sheet) : [];
    if (cols.length > 0) return cols.map((c) => c.month).sort().at(-1)!;
    return '??';
  }

  /**
   * Extract the TOP-100 model grid (sheet 2-7, section 2-7-1), one row per SKU per month
   * (ADR-0043 §1). Absent in the 综合分析精华版 variant, so returns [] when missing. Offset-
   * agnostic: attribute columns are located by their header label and month columns by the
   * `YY.MM` pattern, so it survives layout shifts the same way the 2-1/2-5 parsers do.
   */
  private extractModels(
    workbook: ExcelJS.Workbook,
    category: string,
    sourceReport: string,
  ): ModelMetricRow[] {
    const sheet = workbook.getWorksheet(FULL_VARIANT_SHEET);
    if (!sheet) return []; // essence variant: no model layer at all — a legitimate empty.

    // From here the full-variant model sheet IS present, so a parse failure is an unrecognized
    // layout, not an absence — throw loudly (ADR-0043) so an AVC re-layout surfaces at ingest
    // instead of silently dropping a category's model rows.
    const sectionRow = this.findRow(sheet, (t) => MODEL_SECTION_PATTERN.test(t));
    const layout = sectionRow ? this.findModelLayout(sheet, sectionRow) : null;
    if (!layout) {
      throw new Error(
        `AVC sheet "${FULL_VARIANT_SHEET}" is present in ${sourceReport} but its 2-7-1 model grid ` +
          `could not be parsed (no recognizable month-header row or 机型/品牌 columns) — unrecognized layout.`,
      );
    }

    const rows: ModelMetricRow[] = [];
    for (let r = layout.dataStart; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const title = this.cellText(row.getCell(SECTION_TITLE_COLUMN).value);
      if (MODEL_NEXT_SECTION_PATTERN.test(title)) break; // next 2-7-N sub-section
      const model = this.cellText(row.getCell(layout.modelCol).value);
      const brand = this.cellText(row.getCell(layout.brandCol).value);
      if (!model || !brand) continue;
      // Optional attribute columns are absent in some 2-7 layouts (colOf → 0); guard the
      // out-of-bounds getCell(0) and degrade the missing column to an empty string.
      const attr = (col: number): string => (col ? this.cellText(row.getCell(col).value) : '');
      const heating = attr(layout.heatingCol);
      const launchDate = attr(layout.launchCol);
      const reservation = attr(layout.reservationCol);
      for (const month of layout.months) {
        const valueShare = this.numericValue(row.getCell(layout.valueShareCols[month]).value);
        const volumeShare = this.numericValue(row.getCell(layout.volumeShareCols[month]).value);
        const avgPrice = this.numericValue(row.getCell(layout.avgPriceCols[month]).value);
        if (valueShare === null && volumeShare === null && avgPrice === null) continue;
        rows.push({
          category, model, brand, heating, launchDate, reservation, month,
          valueShare: valueShare ?? 0, volumeShare: volumeShare ?? 0, avgPrice: avgPrice ?? 0,
          sourceReport,
        });
      }
    }
    return rows;
  }

  /** Find the first row at/after `from` whose section-title cell (col C) matches `pred`. */
  private findRow(sheet: ExcelJS.Worksheet, pred: (title: string) => boolean, from = 1): number {
    for (let r = from; r <= sheet.rowCount; r++) {
      if (pred(this.cellText(sheet.getRow(r).getCell(SECTION_TITLE_COLUMN).value))) return r;
    }
    return 0;
  }

  /**
   * Resolve the 2-7 grid's column layout from its two-row header below the section title.
   * The upper header row carries metric-group labels (销额份额 / 销量份额 / 均价) spanning the
   * month columns; the lower row carries the attribute labels (机型/品牌/…) and the `YY.MM`
   * month cells. We map each month column to its metric group by which group label most
   * recently appeared at or before that column in the upper row.
   */
  private findModelLayout(sheet: ExcelJS.Worksheet, sectionRow: number): {
    dataStart: number;
    modelCol: number; brandCol: number; heatingCol: number; launchCol: number; reservationCol: number;
    months: string[];
    valueShareCols: Record<string, number>;
    volumeShareCols: Record<string, number>;
    avgPriceCols: Record<string, number>;
  } | null {
    // The month-header row: the first row after the section title carrying ≥2 YY.MM cells.
    let monthRow = 0;
    for (let r = sectionRow + 1; r <= sheet.rowCount; r++) {
      const months = this.findMonthCells(sheet.getRow(r));
      if (months.length >= 2) { monthRow = r; break; }
    }
    if (!monthRow) return null;
    const groupRow = sheet.getRow(monthRow - 1); // metric-group labels sit one row above
    const labelRow = sheet.getRow(monthRow);     // attribute labels share the month row

    const colOf = (label: string): number => {
      let found = 0;
      labelRow.eachCell((cell, col) => { if (this.cellText(cell.value) === label && !found) found = col; });
      return found;
    };
    const modelCol = colOf(MODEL_LABEL), brandCol = colOf(BRAND_LABEL);
    const heatingCol = colOf(HEATING_LABEL), launchCol = colOf(LAUNCH_LABEL);
    const reservationCol = colOf(RESERVATION_LABEL);
    if (!modelCol || !brandCol) return null;

    // Build a column→metric-group map by carrying the most-recent group label rightward.
    const groupByCol: Record<number, string> = {};
    let current = '';
    groupRow.eachCell((cell, col) => {
      const t = this.cellText(cell.value);
      if (t) current = t;
      groupByCol[col] = current;
    });

    const valueShareCols: Record<string, number> = {};
    const volumeShareCols: Record<string, number> = {};
    const avgPriceCols: Record<string, number> = {};
    const months = new Set<string>();
    for (const { col, month } of this.findMonthCells(labelRow)) {
      const group = groupByCol[col] ?? '';
      if (group.includes('销额份额')) { valueShareCols[month] = col; months.add(month); }
      else if (group.includes('销量份额')) { volumeShareCols[month] = col; months.add(month); }
      else if (group.includes('均价') && !group.includes('累计')) { avgPriceCols[month] = col; months.add(month); }
    }
    if (months.size === 0) return null;

    return {
      dataStart: monthRow + 1,
      modelCol, brandCol, heatingCol, launchCol, reservationCol,
      months: [...months].sort(),
      valueShareCols, volumeShareCols, avgPriceCols,
    };
  }

  /** All `YY.MM` cells in a row, with their column. */
  private findMonthCells(row: ExcelJS.Row): Array<{ col: number; month: string }> {
    const found: Array<{ col: number; month: string }> = [];
    row.eachCell((cell, col) => {
      const text = this.cellText(cell.value);
      if (MONTH_PATTERN.test(text)) found.push({ col, month: text });
    });
    return found;
  }

  /** Find the first 分价格段...零售额 section title row (col C). */
  private findPriceBandSectionRow(sheet: ExcelJS.Worksheet): number {
    for (let r = 1; r <= sheet.rowCount; r++) {
      const title = this.cellText(sheet.getRow(r).getCell(SECTION_TITLE_COLUMN).value);
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
    // eachCell iterates left-to-right, so candidates are already in column order — no sort needed.
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
      const found = this.findMonthCells(row);
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
