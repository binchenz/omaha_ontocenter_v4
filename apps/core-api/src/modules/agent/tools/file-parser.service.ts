import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';

export interface ParsedColumn {
  name: string;
  inferredType: 'string' | 'number' | 'date' | 'boolean';
}

export interface ParsedFile {
  columns: ParsedColumn[];
  sampleRows: Record<string, unknown>[];
  totalRows: number;
}

@Injectable()
export class FileParserService {
  async parse(filePath: string): Promise<ParsedFile> {
    const { headers, rows } = await this.readFile(filePath);
    if (headers.length === 0) {
      return { columns: [], sampleRows: [], totalRows: 0 };
    }

    const columns = headers.map(name => ({
      name,
      inferredType: this.inferType(name, rows.map(r => r[name])),
    }));

    return {
      columns,
      sampleRows: rows.slice(0, 5),
      totalRows: rows.length,
    };
  }

  async parseAll(filePath: string): Promise<Record<string, unknown>[]> {
    const { rows } = await this.readFile(filePath);
    return rows;
  }

  private async readFile(filePath: string): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
    const workbook = new ExcelJS.Workbook();
    if (filePath.endsWith('.csv')) {
      await workbook.csv.readFile(filePath);
    } else {
      await workbook.xlsx.readFile(filePath);
    }

    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.rowCount < 2) {
      return { headers: [], rows: [] };
    }

    const headerRow = sheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell((cell, colNumber) => {
      headers[colNumber - 1] = String(cell.value ?? `col_${colNumber}`);
    });

    const rows: Record<string, unknown>[] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const record: Record<string, unknown> = {};
      row.eachCell((cell, colNumber) => {
        const key = headers[colNumber - 1];
        if (key) record[key] = cell.value;
      });
      rows.push(record);
    });

    return { headers, rows };
  }

  private inferType(columnName: string, values: unknown[]): ParsedColumn['inferredType'] {
    const nonNull = values.filter(v => v != null && v !== '');
    if (nonNull.length === 0) return 'string';

    if (this.looksLikePhone(columnName, nonNull)) return 'string';

    const sample = nonNull.slice(0, 20);

    if (sample.every(v => v instanceof Date || this.isDateString(v))) return 'date';
    if (sample.every(v => typeof v === 'boolean' || this.isBooleanLike(v))) return 'boolean';
    if (sample.every(v => typeof v === 'number' || (typeof v === 'string' && this.isNumericString(v)))) return 'number';

    return 'string';
  }

  private looksLikePhone(name: string, values: unknown[]): boolean {
    const phonePatterns = /电话|手机|phone|mobile|tel/i;
    if (phonePatterns.test(name)) return true;
    return values.slice(0, 5).every(v => /^1[3-9]\d{9}$/.test(String(v)));
  }

  private isDateString(v: unknown): boolean {
    if (v instanceof Date) return true;
    const s = String(v).trim();
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(s)) return true;
    if (/^\d{8}$/.test(s) && parseInt(s.slice(4, 6)) <= 12 && parseInt(s.slice(6, 8)) <= 31) return true;
    return false;
  }

  private isBooleanLike(v: unknown): boolean {
    const s = String(v).toLowerCase();
    return ['是', '否', 'y', 'n', 'yes', 'no', 'true', 'false'].includes(s);
  }

  private isNumericString(v: unknown): boolean {
    if (typeof v === 'number') return true;
    if (typeof v !== 'string') return false;
    const cleaned = v.replace(/[¥￥,，]/g, '');
    return !isNaN(Number(cleaned)) && cleaned.length > 0;
  }
}
