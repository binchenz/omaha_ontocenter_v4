import { SyncJobService, SYNC_JOB_QUEUE } from './sync-job.service';

const T = 'tenant-1';

function make() {
  const jobs: any[] = [];
  let seq = 0;
  const prisma: any = {
    $transaction: jest.fn(async (cb: any) => {
      const tx: any = {
        syncJob: {
          create: jest.fn(async ({ data }: any) => {
            const j = { id: `j${++seq}`, pgBossJobId: null, ...data };
            jobs.push(j);
            return j;
          }),
          update: jest.fn(async ({ where, data }: any) => {
            const j = jobs.find((x) => x.id === where.id)!;
            Object.assign(j, data);
            return j;
          }),
        },
      };
      return cb(tx);
    }),
    syncJob: {
      findFirst: jest.fn(async ({ where }: any) =>
        jobs.find((j) => j.tenantId === where.tenantId && j.id === where.id) ?? null,
      ),
      findMany: jest.fn(async ({ where }: any) => jobs.filter((j) => j.tenantId === where.tenantId)),
    },
  };
  const boss: any = { send: jest.fn(async () => 'boss-id-1') };
  return { svc: new SyncJobService(prisma, boss), jobs, boss };
}

describe('SyncJobService', () => {
  it('creates SyncJob and enqueues to pg-boss transactionally', async () => {
    const { svc, jobs, boss } = make();
    const job = await svc.enqueue(T, 'ds-1', 'map-1');
    expect(jobs).toHaveLength(1);
    expect(boss.send).toHaveBeenCalledWith(
      SYNC_JOB_QUEUE,
      { syncJobId: job.id },
      { retryLimit: 3, retryDelay: 30, retryBackoff: true, expireInSeconds: 14400 },
    );
    expect(job.pgBossJobId).toBe('boss-id-1');
    expect(job.mappingId).toBe('map-1');
  });

  it('throws NotFoundException for unknown job', async () => {
    const { svc } = make();
    await expect(svc.getJob(T, 'x')).rejects.toThrow('not found');
  });

  it('enforces tenant isolation', async () => {
    const { svc, jobs } = make();
    jobs.push({ id: 'j1', tenantId: 'other', status: 'pending' });
    await expect(svc.getJob(T, 'j1')).rejects.toThrow('not found');
  });
});
