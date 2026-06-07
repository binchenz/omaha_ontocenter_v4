import { PipelineRunWorker } from './pipeline-run.worker';

const T = 'tenant-1';

function make() {
  const datasets: any[] = [];
  const datasetRows: any[] = [];
  let seq = 0;

  const pipeline = {
    id: 'pipe-1',
    tenantId: T,
    name: 'clean_market_metric',
    connectorId: 'c-1',
    outputObjectTypeId: 'ot-1',
    status: 'active',
  };

  const steps = [
    { id: 's1', pipelineId: 'pipe-1', order: 1, type: 'filter', config: { column: 'status', value: 'active' } },
    { id: 's2', pipelineId: 'pipe-1', order: 2, type: 'rename', config: { from: 'old_name', to: 'new_name' } },
  ];

  const inputDataset = {
    id: 'ds-raw-1',
    tenantId: T,
    connectorId: 'c-1',
    name: 'avc_raw',
    kind: 'raw',
    status: 'ready',
    rowCount: 3,
    version: 1,
  };

  const inputRows = [
    { id: 'r1', datasetId: 'ds-raw-1', rowIndex: 0, columns: { status: 'active', old_name: 'Alice' } },
    { id: 'r2', datasetId: 'ds-raw-1', rowIndex: 1, columns: { status: 'inactive', old_name: 'Bob' } },
    { id: 'r3', datasetId: 'ds-raw-1', rowIndex: 2, columns: { status: 'active', old_name: 'Charlie' } },
  ];

  const pipelineRunRecord = {
    id: 'run-1',
    tenantId: T,
    pipelineId: 'pipe-1',
    inputDatasetId: 'ds-raw-1',
    outputDatasetId: null,
    status: 'pending',
  };

  const updates: Record<string, any>[] = [];

  const prisma: any = {
    pipelineRun: {
      findFirstOrThrow: jest.fn(async () => pipelineRunRecord),
      update: jest.fn(async ({ data }: any) => {
        Object.assign(pipelineRunRecord, data);
        updates.push(data);
        return pipelineRunRecord;
      }),
    },
    pipeline: {
      findFirstOrThrow: jest.fn(async () => pipeline),
    },
    pipelineStep: {
      findMany: jest.fn(async () => steps),
    },
    dataset: {
      findFirst: jest.fn(async () => inputDataset),
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: any) => {
        const d = { id: `ds-clean-${++seq}`, rowCount: 0, ...data };
        datasets.push(d);
        return d;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const d = datasets.find((x) => x.id === where.id)!;
        if (data.rowCount?.increment) d.rowCount += data.rowCount.increment;
        else Object.assign(d, data);
        return d;
      }),
    },
    datasetRow: {
      findMany: jest.fn(async () => inputRows),
      createMany: jest.fn(async ({ data }: any) => {
        datasetRows.push(...data);
        return { count: data.length };
      }),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };

  const boss: any = { work: jest.fn() };
  const worker = new PipelineRunWorker(boss, prisma);
  return { worker, prisma, datasets, datasetRows, updates, pipelineRunRecord };
}

describe('PipelineRunWorker', () => {
  it('executes steps and produces a clean Dataset', async () => {
    const { worker, datasets, datasetRows } = make();
    const job = { data: { pipelineRunId: 'run-1' } } as any;
    await (worker as any).handle(job);

    // Should create one clean Dataset
    expect(datasets).toHaveLength(1);
    expect(datasets[0].kind).toBe('clean');
    expect(datasets[0].name).toBe('clean_market_metric_clean');
    expect(datasets[0].connectorId).toBe('c-1');

    // Filter step removes inactive row, so 2 rows remain
    expect(datasetRows).toHaveLength(2);
    // Rename step changes old_name → new_name
    expect(datasetRows[0].columns).toHaveProperty('new_name');
    expect(datasetRows[0].columns).not.toHaveProperty('old_name');
  });

  it('marks PipelineRun success with outputDatasetId and recordsProcessed', async () => {
    const { worker, updates } = make();
    const job = { data: { pipelineRunId: 'run-1' } } as any;
    await (worker as any).handle(job);

    expect(updates).toContainEqual(expect.objectContaining({
      status: 'success',
      recordsProcessed: 2,
      outputDatasetId: expect.any(String),
    }));
  });

  it('marks PipelineRun failed on error', async () => {
    const { worker, prisma, updates } = make();
    prisma.datasetRow.findMany.mockRejectedValueOnce(new Error('DB gone'));
    const job = { data: { pipelineRunId: 'run-1' } } as any;
    await expect((worker as any).handle(job)).rejects.toThrow('DB gone');
    expect(updates).toContainEqual(expect.objectContaining({
      status: 'failed',
      error: expect.objectContaining({ message: 'DB gone' }),
    }));
  });
});
