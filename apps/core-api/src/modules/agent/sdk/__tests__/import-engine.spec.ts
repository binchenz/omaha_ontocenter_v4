import { ImportEngine } from '../import-engine.service';
import { FileParserService } from '../../tools/file-parser.service';
import * as path from 'path';
import * as fs from 'fs';
import ExcelJS from 'exceljs';

describe('ImportEngine', () => {
  let engine: ImportEngine;
  let fileParser: FileParserService;
  let csvPath: string;
  let emptyPath: string;

  const upsertedRows: any[] = [];
  const mockTypeResolver = {
    resolve: jest.fn().mockResolvedValue('type-id-123'),
  };
  const mockPrisma: any = {
    $transaction: jest.fn(async (fn: (tx: any) => Promise<any>) => {
      return fn(mockPrisma);
    }),
    objectInstance: {
      upsert: jest.fn(async (args: any) => {
        upsertedRows.push(args);
        return args.create;
      }),
    },
  };

  beforeAll(async () => {
    csvPath = path.join(__dirname, 'import-test.csv');
    emptyPath = path.join(__dirname, 'import-empty.csv');

    const lines = ['id,name,region,amount'];
    for (let i = 1; i <= 20; i++) {
      lines.push(`C${String(i).padStart(3, '0')},客户${i},华东,${i * 1000}`);
    }
    fs.writeFileSync(csvPath, lines.join('\n'));
    fs.writeFileSync(emptyPath, 'id,name\n');
  });

  afterAll(() => {
    if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    if (fs.existsSync(emptyPath)) fs.unlinkSync(emptyPath);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    upsertedRows.length = 0;
    fileParser = new FileParserService();
    engine = new ImportEngine(fileParser, mockTypeResolver as any, mockPrisma as any);
  });

  it('imports all rows from a file (not just 5)', async () => {
    const result = await engine.importFile('tenant-1', {
      filePath: csvPath,
      objectType: 'Customer',
      externalIdColumn: 'id',
      labelColumn: 'name',
    });

    expect(result.imported).toBe(20);
    expect(result.objectType).toBe('Customer');
    expect(upsertedRows).toHaveLength(20);
    expect(mockTypeResolver.resolve).toHaveBeenCalledWith('tenant-1', 'Customer');
  });

  it('upserts on duplicate externalId (idempotent)', async () => {
    await engine.importFile('tenant-1', {
      filePath: csvPath,
      objectType: 'Customer',
      externalIdColumn: 'id',
      labelColumn: 'name',
    });

    const firstUpsert = upsertedRows[0];
    expect(firstUpsert.where).toEqual({
      tenantId_objectType_externalId: {
        tenantId: 'tenant-1',
        objectType: 'Customer',
        externalId: 'C001',
      },
    });
    expect(firstUpsert.create.label).toBe('客户1');
    expect(firstUpsert.update.label).toBe('客户1');
  });

  it('rolls back entirely on mid-batch failure', async () => {
    const failingPrisma = {
      $transaction: jest.fn(async (fn: (tx: any) => Promise<any>) => {
        return fn({
          objectInstance: {
            upsert: jest.fn().mockRejectedValueOnce(new Error('DB write failed')),
          },
        });
      }),
    };
    const failEngine = new ImportEngine(fileParser, mockTypeResolver as any, failingPrisma as any);

    await expect(failEngine.importFile('tenant-1', {
      filePath: csvPath,
      objectType: 'Customer',
      externalIdColumn: 'id',
      labelColumn: 'name',
    })).rejects.toThrow('DB write failed');
  });

  it('handles empty file gracefully', async () => {
    const result = await engine.importFile('tenant-1', {
      filePath: emptyPath,
      objectType: 'Customer',
      externalIdColumn: 'id',
      labelColumn: 'name',
    });

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('uses all columns as properties', async () => {
    await engine.importFile('tenant-1', {
      filePath: csvPath,
      objectType: 'Customer',
      externalIdColumn: 'id',
      labelColumn: 'name',
    });

    const firstCreate = upsertedRows[0].create;
    expect(firstCreate.properties).toMatchObject({
      id: 'C001',
      name: '客户1',
      region: '华东',
      amount: 1000,
    });
  });
});
