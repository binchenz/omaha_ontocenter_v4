import { DatasetService } from './dataset.service';

const T = 'tenant-1';

function make(seed: { datasets?: any[] } = {}) {
  const datasets: any[] = seed.datasets ?? [];
  const rows: any[] = [];
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
  return { svc: new DatasetService(prisma), datasets };
}

describe('DatasetService', () => {
  it('creates a dataset', async () => {
    const { svc } = make();
    const d = await svc.createDataset(T, { name: 'avc', connectorId: 'c1' });
    expect(d.status).toBe('draft');
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
});
