import { ImportEngine } from '../sdk/import-engine.service';
import { BadRequestException } from '@nestjs/common';

describe('ImportEngine allowedValues gate', () => {
  function make(rows: any[], properties: any[]) {
    const fileParser = { parseAll: jest.fn().mockResolvedValue(rows) } as any;
    const typeResolver = { resolve: jest.fn().mockResolvedValue('ot1') } as any;
    const upsert = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      objectType: { findFirst: jest.fn().mockResolvedValue({ properties }) },
      $transaction: jest.fn().mockImplementation(async (fn: any) => fn({ objectInstance: { upsert } })),
    } as any;
    return { engine: new ImportEngine(fileParser, typeResolver, prisma), upsert };
  }

  const params = { filePath: '/tmp/x.csv', objectType: 'order', externalIdColumn: 'id', labelColumn: 'id' };
  const statusDef = [{ name: 'status', label: '状态', type: 'string', allowedValues: ['pending', 'paid'] }];

  it('rejects the whole batch when any row violates allowedValues', async () => {
    const { engine, upsert } = make(
      [{ id: '1', status: 'paid' }, { id: '2', status: 'shipped' }],
      statusDef,
    );
    await expect(engine.importFile('t1', params)).rejects.toThrow(BadRequestException);
    expect(upsert).not.toHaveBeenCalled(); // nothing written
  });

  it('imports normally when all values are allowed', async () => {
    const { engine, upsert } = make(
      [{ id: '1', status: 'paid' }, { id: '2', status: 'pending' }],
      statusDef,
    );
    const res = await engine.importFile('t1', params);
    expect(res.imported).toBe(2);
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('imports normally when the type has no allowedValues constraints', async () => {
    const { engine, upsert } = make(
      [{ id: '1', status: 'anything' }],
      [{ name: 'status', label: '状态', type: 'string' }],
    );
    const res = await engine.importFile('t1', params);
    expect(res.imported).toBe(1);
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});
