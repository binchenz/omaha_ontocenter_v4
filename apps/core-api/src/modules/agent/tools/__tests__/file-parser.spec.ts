import { FileParserService } from '../file-parser.service';
import * as path from 'path';
import * as fs from 'fs';
import ExcelJS from 'exceljs';

describe('FileParserService', () => {
  let service: FileParserService;
  let testFilePath: string;
  let csvFilePath: string;

  beforeAll(async () => {
    service = new FileParserService();
    testFilePath = path.join(__dirname, 'test-customers.xlsx');
    csvFilePath = path.join(__dirname, 'test-data.csv');

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(['客户名称', '区域', '等级', '电话', '金额', '注册日期']);
    sheet.addRow(['华东科技', '华东', 'A', '13800138001', 75000, '2024-03-15']);
    sheet.addRow(['北方工业', '华北', 'B', '13900139002', 50000, '2024-01-20']);
    sheet.addRow(['南方贸易', '华南', 'A', '13700137003', 120000, '2023-11-05']);
    await workbook.xlsx.writeFile(testFilePath);

    fs.writeFileSync(csvFilePath, [
      '产品名,价格,是否上架,上架日期',
      '笔记本电脑,8999,是,2024-03-15',
      '无线鼠标,199,否,2024/1/5',
      '显示器,2500,是,20240220',
    ].join('\n'));
  });

  afterAll(() => {
    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
    if (fs.existsSync(csvFilePath)) fs.unlinkSync(csvFilePath);
  });

  it('parses Excel file and infers column types', async () => {
    const result = await service.parse(testFilePath);

    expect(result.columns).toHaveLength(6);
    expect(result.columns[0]).toMatchObject({ name: '客户名称', inferredType: 'string' });
    expect(result.columns[1]).toMatchObject({ name: '区域', inferredType: 'string' });
    expect(result.columns[2]).toMatchObject({ name: '等级', inferredType: 'string' });
    expect(result.columns[3]).toMatchObject({ name: '电话', inferredType: 'string' });
    expect(result.columns[4]).toMatchObject({ name: '金额', inferredType: 'number' });
    expect(result.columns[5]).toMatchObject({ name: '注册日期', inferredType: 'date' });

    expect(result.sampleRows).toHaveLength(3);
    expect(result.totalRows).toBe(3);
  });

  it('treats phone numbers as string not number', async () => {
    const result = await service.parse(testFilePath);
    const phoneCol = result.columns.find(c => c.name === '电话');
    expect(phoneCol?.inferredType).toBe('string');
  });

  it('parses CSV files', async () => {
    const result = await service.parse(csvFilePath);

    expect(result.columns).toHaveLength(4);
    expect(result.columns[0]).toMatchObject({ name: '产品名', inferredType: 'string' });
    expect(result.totalRows).toBe(3);
  });

  it('detects boolean-like values', async () => {
    const result = await service.parse(csvFilePath);
    const boolCol = result.columns.find(c => c.name === '是否上架');
    expect(boolCol?.inferredType).toBe('boolean');
  });

  it('detects dates in various formats', async () => {
    const result = await service.parse(csvFilePath);
    const dateCol = result.columns.find(c => c.name === '上架日期');
    expect(dateCol?.inferredType).toBe('date');
  });

  describe('parseAll', () => {
    let largeCsvPath: string;
    let largeExcelPath: string;

    beforeAll(async () => {
      largeCsvPath = path.join(__dirname, 'test-large.csv');
      largeExcelPath = path.join(__dirname, 'test-large.xlsx');

      const csvLines = ['name,value'];
      for (let i = 1; i <= 20; i++) {
        csvLines.push(`item_${i},${i * 100}`);
      }
      fs.writeFileSync(largeCsvPath, csvLines.join('\n'));

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Sheet1');
      sheet.addRow(['name', 'value']);
      for (let i = 1; i <= 20; i++) {
        sheet.addRow([`item_${i}`, i * 100]);
      }
      await workbook.xlsx.writeFile(largeExcelPath);
    });

    afterAll(() => {
      if (fs.existsSync(largeCsvPath)) fs.unlinkSync(largeCsvPath);
      if (fs.existsSync(largeExcelPath)) fs.unlinkSync(largeExcelPath);
    });

    it('returns all rows from a CSV file (not capped at 5)', async () => {
      const rows = await service.parseAll(largeCsvPath);
      expect(rows).toHaveLength(20);
      expect(rows[0]).toMatchObject({ name: 'item_1', value: 100 });
      expect(rows[19]).toMatchObject({ name: 'item_20', value: 2000 });
    });

    it('returns all rows from an Excel file (not capped at 5)', async () => {
      const rows = await service.parseAll(largeExcelPath);
      expect(rows).toHaveLength(20);
      expect(rows[0]).toMatchObject({ name: 'item_1', value: 100 });
      expect(rows[19]).toMatchObject({ name: 'item_20', value: 2000 });
    });
  });
});
