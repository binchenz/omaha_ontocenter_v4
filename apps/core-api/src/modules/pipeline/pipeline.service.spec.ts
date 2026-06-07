import { PipelineService } from './pipeline.service';

const T = 'tenant-1';

function make(seed: { pipelines?: any[]; steps?: any[] } = {}) {
  const pipelines: any[] = seed.pipelines ?? [];
  const steps: any[] = seed.steps ?? [];
  let seq = 0;
  const prisma: any = {
    pipeline: {
      findMany: jest.fn(async ({ where }: any) => pipelines.filter((p) => p.tenantId === where.tenantId)),
      findFirst: jest.fn(async ({ where }: any) =>
        pipelines.find((p) => p.tenantId === where.tenantId && p.id === where.id) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const p = { id: `p${++seq}`, status: 'active', ...data };
        pipelines.push(p);
        return p;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const p = pipelines.find((x) => x.id === where.id)!;
        Object.assign(p, data);
        return p;
      }),
      delete: jest.fn(async ({ where }: any) => {
        const idx = pipelines.findIndex((x) => x.id === where.id);
        return pipelines.splice(idx, 1)[0];
      }),
    },
    pipelineStep: {
      findMany: jest.fn(async ({ where, orderBy }: any) =>
        steps.filter((s) => s.pipelineId === where.pipelineId).sort((a: any, b: any) => a.order - b.order),
      ),
      create: jest.fn(async ({ data }: any) => {
        const s = { id: `s${++seq}`, ...data };
        steps.push(s);
        return s;
      }),
      delete: jest.fn(async ({ where }: any) => {
        const idx = steps.findIndex((x) => x.id === where.id);
        return steps.splice(idx, 1)[0];
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const removed = steps.filter((s) => s.pipelineId === where.pipelineId);
        removed.forEach((r) => steps.splice(steps.indexOf(r), 1));
        return { count: removed.length };
      }),
    },
  };
  return { svc: new PipelineService(prisma), pipelines, steps, prisma };
}

describe('PipelineService', () => {
  it('creates a pipeline', async () => {
    const { svc } = make();
    const p = await svc.createPipeline(T, { name: 'clean-avc', connectorId: 'c1', outputObjectTypeId: 'ot1' });
    expect(p.name).toBe('clean-avc');
    expect(p.tenantId).toBe(T);
    expect(p.status).toBe('active');
  });

  it('lists pipelines by tenant', async () => {
    const { svc } = make({
      pipelines: [
        { id: 'p1', tenantId: T, name: 'a' },
        { id: 'p2', tenantId: 'other', name: 'b' },
      ],
    });
    const list = await svc.listPipelines(T);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('p1');
  });

  it('throws NotFoundException for unknown pipeline', async () => {
    const { svc } = make();
    await expect(svc.getPipeline(T, 'x')).rejects.toThrow('not found');
  });

  it('adds a step to a pipeline', async () => {
    const { svc, steps } = make({ pipelines: [{ id: 'p1', tenantId: T }] });
    const s = await svc.addStep(T, 'p1', { order: 1, type: 'filter', config: { column: 'status', value: 'active' } });
    expect(s.pipelineId).toBe('p1');
    expect(s.type).toBe('filter');
    expect(steps).toHaveLength(1);
  });

  it('lists steps ordered by order', async () => {
    const { svc } = make({
      pipelines: [{ id: 'p1', tenantId: T }],
      steps: [
        { id: 's1', pipelineId: 'p1', order: 2, type: 'compute' },
        { id: 's2', pipelineId: 'p1', order: 1, type: 'filter' },
      ],
    });
    const list = await svc.listSteps(T, 'p1');
    expect(list[0].order).toBe(1);
    expect(list[1].order).toBe(2);
  });

  it('enforces tenant isolation', async () => {
    const { svc } = make({ pipelines: [{ id: 'p1', tenantId: 'other' }] });
    await expect(svc.getPipeline(T, 'p1')).rejects.toThrow('not found');
  });
});
