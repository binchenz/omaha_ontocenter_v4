import { SyncJobWorker } from './sync-job.worker';

const T = 'tenant-1';

function make(overrides: { datasetKind?: string } = {}) {
  const syncJob = { id: 'sj-1', tenantId: T, datasetId: 'ds-1', mappingId: 'm-1', status: 'pending' };
  const dataset = { id: 'ds-1', tenantId: T, kind: overrides.datasetKind ?? 'clean', status: 'ready', rowCount: 2 };
  const mapping = { id: 'm-1', tenantId: T, objectTypeId: 'ot-1', propertyMappings: { name: 'col_name' } };
  const objectType = { id: 'ot-1', name: 'Widget' };
  const rows = [
    { columns: { col_name: 'a', externalId: 'e1' }, rowIndex: 0 },
    { columns: { col_name: 'b', externalId: 'e2' }, rowIndex: 1 },
  ];

  const updates: Record<string, any>[] = [];
  const prisma: any = {
    syncJob: {
      findFirstOrThrow: jest.fn(async () => syncJob),
      update: jest.fn(async ({ data }: any) => { updates.push(data); return { ...syncJob, ...data }; }),
    },
    dataset: {
      findFirst: jest.fn(async () => dataset),
    },
    objectMapping: {
      findFirstOrThrow: jest.fn(async () => mapping),
    },
    datasetRow: {
      findMany: jest.fn(async () => rows),
    },
    objectType: {
      findFirstOrThrow: jest.fn(async () => objectType),
    },
  };
  const importEngine: any = {
    importInstances: jest.fn(async () => ({ imported: 2 })),
  };
  const boss: any = { work: jest.fn() };
  const worker = new SyncJobWorker(boss, prisma, importEngine);
  return { worker, prisma, importEngine, updates, boss };
}

describe('SyncJobWorker', () => {
  it('rejects a raw Dataset with failed status (permanent, no rethrow)', async () => {
    const { worker, updates } = make({ datasetKind: 'raw' });
    const job = { data: { syncJobId: 'sj-1' } } as any;
    // Should NOT rethrow — permanent error
    await (worker as any).handle(job);
    expect(updates).toContainEqual(expect.objectContaining({
      status: 'failed',
      errorLog: expect.objectContaining({ type: 'permanent' }),
    }));
  });

  it('proceeds normally with a clean Dataset', async () => {
    const { worker, importEngine, prisma } = make({ datasetKind: 'clean' });
    const job = { data: { syncJobId: 'sj-1' } } as any;
    await (worker as any).handle(job);
    expect(importEngine.importInstances).toHaveBeenCalledWith(T, 'Widget', expect.any(Array));
    // Mapping looked up by mappingId from SyncJob record, not by datasetId
    expect(prisma.objectMapping.findFirstOrThrow).toHaveBeenCalledWith({ where: { id: 'm-1' } });
  });

  it('permanent error (validation) — marks failed immediately, does NOT rethrow', async () => {
    const { worker, importEngine, updates } = make({ datasetKind: 'clean' });
    const validationErr = new Error('allowedValues violation: field "status" got "invalid"');
    (validationErr as any).name = 'ValidationError';
    importEngine.importInstances.mockRejectedValueOnce(validationErr);
    const job = { data: { syncJobId: 'sj-1' } } as any;
    // Should NOT rethrow — pg-boss won't retry
    await (worker as any).handle(job);
    expect(updates).toContainEqual(expect.objectContaining({
      status: 'failed',
      errorLog: expect.objectContaining({ type: 'permanent' }),
    }));
  });

  it('transient error (DB timeout) — rethrows for pg-boss retry', async () => {
    const { worker, importEngine } = make({ datasetKind: 'clean' });
    const timeoutErr = new Error('Connection timed out');
    (timeoutErr as any).code = 'P2024';
    importEngine.importInstances.mockRejectedValueOnce(timeoutErr);
    const job = { data: { syncJobId: 'sj-1' } } as any;
    // Should rethrow — pg-boss retries
    await expect((worker as any).handle(job)).rejects.toThrow('Connection timed out');
  });

  it('sets recordsProcessed on success', async () => {
    const { worker, updates } = make({ datasetKind: 'clean' });
    const job = { data: { syncJobId: 'sj-1' } } as any;
    await (worker as any).handle(job);
    expect(updates).toContainEqual(expect.objectContaining({
      status: 'success',
      recordsProcessed: 2,
    }));
  });
});
