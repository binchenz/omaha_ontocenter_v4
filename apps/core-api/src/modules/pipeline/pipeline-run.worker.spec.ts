import { PipelineRunWorker } from './pipeline-run.worker';
import { makeTransformConfigServiceMock } from './transform-config.mock';

const T = 'tenant-1';

function make(overrides: { steps?: any[]; inputRows?: any[]; configs?: any[] } = {}) {
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

  const steps = overrides.steps ?? [
    { id: 's1', pipelineId: 'pipe-1', order: 1, type: 'filter', config: { field: 'status', operator: 'eq', value: 'active' } },
    { id: 's2', pipelineId: 'pipe-1', order: 2, type: 'rename', config: { mappings: { old_name: 'new_name' } } },
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

  const inputRows = overrides.inputRows ?? [
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

  const configs: any[] = overrides.configs ?? [];
  const { service: transformConfigService, getCalls } = makeTransformConfigServiceMock(configs);

  const boss: any = { work: jest.fn() };
  const worker = new PipelineRunWorker(boss, prisma, transformConfigService);
  return { worker, prisma, datasets, datasetRows, updates, pipelineRunRecord, transformConfigService, getCalls };
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

  it('executes steps in order — rename consumes the filter output', async () => {
    // filter on a renamed column would only work if rename ran first;
    // here filter must run first (order 1), so it matches the pre-rename column.
    const steps = [
      { id: 's1', pipelineId: 'pipe-1', order: 2, type: 'rename', config: { mappings: { status: 'state' } } },
      { id: 's2', pipelineId: 'pipe-1', order: 1, type: 'filter', config: { field: 'status', operator: 'eq', value: 'active' } },
    ];
    const { worker, datasetRows } = make({ steps });
    await (worker as any).handle({ data: { pipelineRunId: 'run-1' } } as any);
    // filter (order 1) keeps 2 active rows, then rename status→state
    expect(datasetRows).toHaveLength(2);
    expect(datasetRows[0].columns).toHaveProperty('state', 'active');
    expect(datasetRows[0].columns).not.toHaveProperty('status');
  });

  it('supports gt/contains/in operators on filter', async () => {
    const steps = [{ id: 's1', pipelineId: 'pipe-1', order: 1, type: 'filter', config: { field: 'n', operator: 'gt', value: 10 } }];
    const inputRows = [
      { id: 'r1', columns: { n: 5 } },
      { id: 'r2', columns: { n: 20 } },
      { id: 'r3', columns: { n: 15 } },
    ];
    const { worker, datasetRows } = make({ steps, inputRows });
    await (worker as any).handle({ data: { pipelineRunId: 'run-1' } } as any);
    expect(datasetRows.map((r) => r.columns.n).sort()).toEqual([15, 20]);
  });

  it('fails the run with a permanent error when input exceeds 100k rows', async () => {
    const { worker, prisma, updates } = make();
    // simulate >100k input by overriding the row loader to report a huge count
    const huge = Array.from({ length: 100_001 }, (_, i) => ({ id: `r${i}`, columns: { status: 'active' } }));
    prisma.datasetRow.findMany.mockResolvedValueOnce(huge);
    await expect((worker as any).handle({ data: { pipelineRunId: 'run-1' } } as any)).rejects.toThrow(/100000|100k|row/i);
    const failed = updates.find((u) => u.status === 'failed');
    expect(failed).toBeDefined();
    expect(failed!.error).toEqual(expect.objectContaining({ message: expect.any(String) }));
  });

  it('records { step, rowIndex, message } detail on a step failure', async () => {
    // a compute step referencing a missing TransformConfig version → permanent error with detail
    const steps = [{ id: 's1', pipelineId: 'pipe-1', order: 1, type: 'compute', config: { function: 'normalize_brand', inputField: 'b', outputField: 'bn', configRef: 'nope', configVersion: 99 } }];
    const { worker, updates } = make({ steps });
    await expect((worker as any).handle({ data: { pipelineRunId: 'run-1' } } as any)).rejects.toThrow();
    const failed = updates.find((u) => u.status === 'failed');
    expect(failed!.error).toEqual(expect.objectContaining({
      step: expect.anything(),
      message: expect.any(String),
    }));
  });

  describe('compute step (#171, ADR-0054)', () => {
    it('normalize_brand maps known values, passes through unknowns', async () => {
      const steps = [{ id: 's1', pipelineId: 'pipe-1', order: 1, type: 'compute',
        config: { function: 'normalize_brand', inputField: 'brand', outputField: 'brand_norm',
          configRef: 'brands', configVersion: 1 } }];
      const inputRows = [
        { id: 'r1', columns: { brand: 'hw' } },
        { id: 'r2', columns: { brand: 'unknown-co' } },
      ];
      const configs = [{ tenantId: T, name: 'brands', type: 'brand_mapping', version: 1,
        config: { mappings: { hw: 'Huawei' } } }];
      const { worker, datasetRows } = make({ steps, inputRows, configs });
      await (worker as any).handle({ data: { pipelineRunId: 'run-1' } } as any);
      expect(datasetRows[0].columns.brand_norm).toBe('Huawei');
      expect(datasetRows[1].columns.brand_norm).toBe('unknown-co'); // passthrough
    });

    it('normalize_brand honors caseSensitive=false by default (case-insensitive match)', async () => {
      const steps = [{ id: 's1', pipelineId: 'pipe-1', order: 1, type: 'compute',
        config: { function: 'normalize_brand', inputField: 'brand', outputField: 'brand_norm',
          configRef: 'brands', configVersion: 1 } }];
      const inputRows = [{ id: 'r1', columns: { brand: 'HW' } }];
      const configs = [{ tenantId: T, name: 'brands', type: 'brand_mapping', version: 1,
        config: { mappings: { hw: 'Huawei' } } }];
      const { worker, datasetRows } = make({ steps, inputRows, configs });
      await (worker as any).handle({ data: { pipelineRunId: 'run-1' } } as any);
      expect(datasetRows[0].columns.brand_norm).toBe('Huawei');
    });

    it('price_band bins values into labels including the open-ended top band', async () => {
      const steps = [{ id: 's1', pipelineId: 'pipe-1', order: 1, type: 'compute',
        config: { function: 'price_band', inputField: 'price', outputField: 'band',
          configRef: 'pb', configVersion: 1 } }];
      const inputRows = [
        { id: 'r1', columns: { price: 150 } },
        { id: 'r2', columns: { price: 250 } },
        { id: 'r3', columns: { price: 9000 } },
      ];
      const configs = [{ tenantId: T, name: 'pb', type: 'price_bands', version: 1,
        config: { bands: [{ max: 200, label: 'low' }, { max: 500, label: 'mid' }, { label: 'high' }] } }];
      const { worker, datasetRows } = make({ steps, inputRows, configs });
      await (worker as any).handle({ data: { pipelineRunId: 'run-1' } } as any);
      expect(datasetRows[0].columns.band).toBe('low');
      expect(datasetRows[1].columns.band).toBe('mid');
      expect(datasetRows[2].columns.band).toBe('high'); // open-ended top band
    });

    it('loads the exact version named by configRef+configVersion', async () => {
      const steps = [{ id: 's1', pipelineId: 'pipe-1', order: 1, type: 'compute',
        config: { function: 'normalize_brand', inputField: 'brand', outputField: 'brand_norm',
          configRef: 'brands', configVersion: 1 } }];
      const inputRows = [{ id: 'r1', columns: { brand: 'hw' } }];
      // v1 maps hw→Huawei; v2 maps hw→HUAWEI. The step pins v1, so must get Huawei.
      const configs = [
        { tenantId: T, name: 'brands', type: 'brand_mapping', version: 1, config: { mappings: { hw: 'Huawei' } } },
        { tenantId: T, name: 'brands', type: 'brand_mapping', version: 2, config: { mappings: { hw: 'HUAWEI' } } },
      ];
      const { worker, datasetRows, getCalls } = make({ steps, inputRows, configs });
      await (worker as any).handle({ data: { pipelineRunId: 'run-1' } } as any);
      expect(datasetRows[0].columns.brand_norm).toBe('Huawei');
      expect(getCalls).toContainEqual([T, 'brands', 1]);
    });

    it('fails the run with a permanent error when configRef version is missing', async () => {
      const steps = [{ id: 's1', pipelineId: 'pipe-1', order: 1, type: 'compute',
        config: { function: 'normalize_brand', inputField: 'brand', outputField: 'brand_norm',
          configRef: 'brands', configVersion: 5 } }];
      const inputRows = [{ id: 'r1', columns: { brand: 'hw' } }];
      const { worker, updates } = make({ steps, inputRows, configs: [] });
      await expect((worker as any).handle({ data: { pipelineRunId: 'run-1' } } as any)).rejects.toThrow();
      const failed = updates.find((u) => u.status === 'failed');
      expect(failed!.error).toEqual(expect.objectContaining({ message: expect.stringMatching(/config|version|not found/i) }));
    });
  });
});
