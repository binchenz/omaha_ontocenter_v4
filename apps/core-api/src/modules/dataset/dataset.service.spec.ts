import { DatasetService } from './dataset.service';

const T = 'tenant-1';

function make(seed: { datasets?: any[] } = {}) {
  const datasets: any[] = seed.datasets ?? [];
  const rows: any[] = [];
  const orchestrator: any = {
    onRawDatasetReady: jest.fn(async () => undefined),
  };
  const prisma: any = {
    dataset: {
      findMany: jest.fn(async ({ where }: any) => datasets.filter((d) => d.tenantId === where.tenantId)),
      findFirst: jest.fn(async ({ where }: any) =>
        datasets.find((d) => d.tenantId === where.tenantId && d.id === where.id) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const d = { id: 'ds-1', status: 'draft', rowCount: 0, ...data };
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
      count: jest.fn(async () => rows.length),
      createMany: jest.fn(async ({ data: r }: any) => rows.push(...r)),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };
  return { svc: new DatasetService(prisma, orchestrator), datasets, orchestrator };
}

describe('DatasetService', () => {
  it('creates a dataset', async () => {
    const { svc } = make();
    const d = await svc.createDataset(T, { name: 'avc', connectorId: 'c1' });
    expect(d.status).toBe('draft');
  });

  it('persists alignKeyValue when the connector supplies a batch key (#186)', async () => {
    const { svc, datasets } = make();
    await svc.createDataset(T, { name: 'avc', connectorId: 'c1', kind: 'raw', alignKeyValue: '25.06' });
    expect(datasets[0].alignKeyValue).toBe('25.06');
  });

  it('appendRows increments rowCount', async () => {
    const { svc, datasets } = make({ datasets: [{ id: 'ds-1', tenantId: T, rowCount: 0 }] });
    await svc.appendRows(T, 'ds-1', [{ v: 1 }, { v: 2 }]);
    expect(datasets[0].rowCount).toBe(2);
  });

  it('markReady sets status ready', async () => {
    const { svc, datasets } = make({ datasets: [{ id: 'ds-1', tenantId: T, rowCount: 0, status: 'draft' }] });
    await svc.markReady(T, 'ds-1');
    expect(datasets[0].status).toBe('ready');
  });

  it('throws NotFoundException for unknown dataset', async () => {
    const { svc } = make();
    await expect(svc.getDataset(T, 'x')).rejects.toThrow('not found');
  });

  it('enforces tenant isolation', async () => {
    const { svc } = make({ datasets: [{ id: 'ds-1', tenantId: 'other', rowCount: 0 }] });
    await expect(svc.getDataset(T, 'ds-1')).rejects.toThrow('not found');
  });

  describe('markReady reactive trigger (#168, ADR-0045)', () => {
    it('fires onRawDatasetReady for a raw Dataset', async () => {
      const { svc, orchestrator } = make({
        datasets: [{ id: 'ds-1', tenantId: T, rowCount: 0, status: 'draft', kind: 'raw' }],
      });
      await svc.markReady(T, 'ds-1');
      expect(orchestrator.onRawDatasetReady).toHaveBeenCalledWith(T, 'ds-1');
    });

    it('does NOT fire onRawDatasetReady for a clean Dataset', async () => {
      const { svc, orchestrator } = make({
        datasets: [{ id: 'ds-1', tenantId: T, rowCount: 0, status: 'draft', kind: 'clean' }],
      });
      await svc.markReady(T, 'ds-1');
      expect(orchestrator.onRawDatasetReady).not.toHaveBeenCalled();
    });

    it('does not throw if the orchestrator trigger fails (fire-and-forget)', async () => {
      const { svc, datasets, orchestrator } = make({
        datasets: [{ id: 'ds-1', tenantId: T, rowCount: 0, status: 'draft', kind: 'raw' }],
      });
      orchestrator.onRawDatasetReady.mockRejectedValueOnce(new Error('orchestrator boom'));
      const result = await svc.markReady(T, 'ds-1');
      // status still flipped to ready — trigger failure must not roll it back
      expect(result.status).toBe('ready');
      expect(datasets[0].status).toBe('ready');
    });
  });
});
