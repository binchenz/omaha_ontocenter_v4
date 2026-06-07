import { PipelineRunService, PIPELINE_RUN_QUEUE } from './pipeline-run.service';

const T = 'tenant-1';

function make() {
  const runs: any[] = [];
  let seq = 0;
  const prisma: any = {
    $transaction: jest.fn(async (cb: any) => {
      const tx: any = {
        pipelineRun: {
          create: jest.fn(async ({ data }: any) => {
            const r = { id: `run${++seq}`, pgBossJobId: null, ...data };
            runs.push(r);
            return r;
          }),
          update: jest.fn(async ({ where, data }: any) => {
            const r = runs.find((x) => x.id === where.id)!;
            Object.assign(r, data);
            return r;
          }),
        },
      };
      return cb(tx);
    }),
    pipelineRun: {
      findFirst: jest.fn(async ({ where }: any) =>
        runs.find((r) => r.tenantId === where.tenantId && r.id === where.id) ?? null,
      ),
      findMany: jest.fn(async ({ where }: any) =>
        runs.filter((r) => r.tenantId === where.tenantId),
      ),
    },
  };
  const boss: any = { send: jest.fn(async () => 'boss-run-1') };
  return { svc: new PipelineRunService(prisma, boss), runs, boss };
}

describe('PipelineRunService', () => {
  it('creates PipelineRun and enqueues to pg-boss transactionally', async () => {
    const { svc, runs, boss } = make();
    const run = await svc.enqueue(T, 'pipe-1', 'ds-raw-1');
    expect(runs).toHaveLength(1);
    expect(boss.send).toHaveBeenCalledWith(
      PIPELINE_RUN_QUEUE,
      { pipelineRunId: run.id },
      { retryLimit: 1, retryDelay: 30, retryBackoff: true, expireInSeconds: 3600 },
    );
    expect(run.pgBossJobId).toBe('boss-run-1');
    expect(run.pipelineId).toBe('pipe-1');
    expect(run.inputDatasetId).toBe('ds-raw-1');
  });

  it('throws NotFoundException for unknown run', async () => {
    const { svc } = make();
    await expect(svc.getRun(T, 'x')).rejects.toThrow('not found');
  });
});
