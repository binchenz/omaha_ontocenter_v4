import { PipelineService } from './pipeline.service';
import { makeTransformConfigServiceMock } from './transform-config.mock';

const T = 'tenant-1';

function make(seed: { pipelines?: any[]; steps?: any[]; configs?: any[] } = {}) {
  const pipelines: any[] = seed.pipelines ?? [];
  const steps: any[] = seed.steps ?? [];
  const configs: any[] = seed.configs ?? [];
  const inputs: any[] = [];
  let seq = 0;
  const prisma: any = {
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    pipelineInput: {
      createMany: jest.fn(async ({ data }: any) => {
        inputs.push(...data);
        return { count: data.length };
      }),
    },
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
  // TransformConfigService mock: get() resolves latest version when version omitted (ADR-0054).
  const { service: transformConfigService, getCalls } = makeTransformConfigServiceMock(configs);
  return {
    svc: new PipelineService(prisma, transformConfigService),
    pipelines,
    steps,
    inputs,
    prisma,
    transformConfigService,
    getCalls,
  };
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
    const s = await svc.addStep(T, 'p1', { order: 1, type: 'filter', config: { field: 'status', operator: 'eq', value: 'active' } });
    expect(s.pipelineId).toBe('p1');
    expect(s.type).toBe('filter');
    expect(steps).toHaveLength(1);
  });

  it('rejects a step whose config fails its type schema (ADR-0053)', async () => {
    const { svc, steps } = make({ pipelines: [{ id: 'p1', tenantId: T }] });
    await expect(
      svc.addStep(T, 'p1', { order: 1, type: 'filter', config: { field: 'x', operator: 'regex', value: 'y' } }),
    ).rejects.toThrow('Invalid');
    expect(steps).toHaveLength(0);
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

  describe('configurePipeline (#172, atomic create + configRef pinning)', () => {
    const baseDto = () => ({
      name: 'clean-avc',
      connectorId: 'c1',
      outputObjectTypeId: 'ot1',
      steps: [
        { order: 1, type: 'filter', config: { field: 'status', operator: 'eq', value: 'active' } },
        { order: 2, type: 'rename', config: { mappings: { brand: 'brand_raw' } } },
      ],
    });

    it('creates Pipeline + ordered Steps atomically in one call', async () => {
      const { svc, pipelines, steps } = make();
      const res = await svc.configurePipeline(T, baseDto());
      expect(res.pipelineId).toBeDefined();
      expect(pipelines).toHaveLength(1);
      expect(steps).toHaveLength(2);
      expect(steps.map((s) => s.order)).toEqual([1, 2]);
    });

    it('aborts the whole call when any step config is invalid — nothing persisted', async () => {
      const { svc, pipelines, steps } = make();
      const dto = baseDto();
      (dto.steps[1].config as any) = { mappings: 'not-an-object' };
      await expect(svc.configurePipeline(T, dto)).rejects.toThrow('Invalid');
      expect(pipelines).toHaveLength(0);
      expect(steps).toHaveLength(0);
    });

    it('pins a compute step configRef to the current latest version when no version given', async () => {
      const { svc, steps, getCalls } = make({
        configs: [
          { tenantId: T, name: 'brands', type: 'brand_mapping', version: 1, config: { mappings: {} } },
          { tenantId: T, name: 'brands', type: 'brand_mapping', version: 3, config: { mappings: {} } },
        ],
      });
      const dto = baseDto();
      dto.steps.push({
        order: 3,
        type: 'compute',
        config: { function: 'normalize_brand', inputField: 'brand_raw', outputField: 'brand', configRef: 'brands' },
      } as any);
      await svc.configurePipeline(T, dto);
      const computeStep = steps.find((s) => s.type === 'compute')!;
      expect((computeStep.config as any).configVersion).toBe(3);
      expect(getCalls).toContainEqual([T, 'brands', undefined]);
    });

    it('preserves an explicit compute configVersion (no re-pin)', async () => {
      const { svc, steps, transformConfigService } = make({
        configs: [{ tenantId: T, name: 'brands', type: 'brand_mapping', version: 9, config: { mappings: {} } }],
      });
      const dto = baseDto();
      dto.steps.push({
        order: 3,
        type: 'compute',
        config: { function: 'normalize_brand', inputField: 'brand_raw', outputField: 'brand', configRef: 'brands', configVersion: 2 },
      } as any);
      await svc.configurePipeline(T, dto);
      const computeStep = steps.find((s) => s.type === 'compute')!;
      expect((computeStep.config as any).configVersion).toBe(2);
      expect(transformConfigService.get).not.toHaveBeenCalled();
    });

    it('autoActivate=false creates the Pipeline in draft', async () => {
      const { svc } = make();
      const res = await svc.configurePipeline(T, { ...baseDto(), autoActivate: false });
      expect(res.status).toBe('draft');
    });

    it('autoActivate=true creates the Pipeline active', async () => {
      const { svc } = make();
      const res = await svc.configurePipeline(T, { ...baseDto(), autoActivate: true });
      expect(res.status).toBe('active');
    });

    describe('declaredInputs (#187, multi-input provisioning)', () => {
      it('creates a PipelineInput row per declared input, scoped to the new Pipeline + tenant', async () => {
        const { svc, inputs } = make();
        const res = await svc.configurePipeline(T, {
          ...baseDto(),
          declaredInputs: [
            { inputName: 'orders', connectorId: 'c-orders' },
            { inputName: 'refunds', connectorId: 'c-refunds', alignKeyField: 'reportMonth' },
          ],
        });
        expect(inputs).toEqual([
          { tenantId: T, pipelineId: res.pipelineId, inputName: 'orders', connectorId: 'c-orders', alignKeyField: null },
          { tenantId: T, pipelineId: res.pipelineId, inputName: 'refunds', connectorId: 'c-refunds', alignKeyField: 'reportMonth' },
        ]);
      });

      it('writes no PipelineInput rows when declaredInputs is omitted (single-input unchanged)', async () => {
        const { svc, inputs } = make();
        await svc.configurePipeline(T, baseDto());
        expect(inputs).toHaveLength(0);
      });

      it('writes no PipelineInput rows for an empty declaredInputs array', async () => {
        const { svc, inputs } = make();
        await svc.configurePipeline(T, { ...baseDto(), declaredInputs: [] });
        expect(inputs).toHaveLength(0);
      });

      it('rejects duplicate inputName before any write (preserves atomic-create guarantee)', async () => {
        const { svc, pipelines, inputs } = make();
        await expect(
          svc.configurePipeline(T, {
            ...baseDto(),
            declaredInputs: [
              { inputName: 'orders', connectorId: 'c-a' },
              { inputName: 'orders', connectorId: 'c-b' },
            ],
          }),
        ).rejects.toThrow(/duplicate inputName/i);
        expect(pipelines).toHaveLength(0);
        expect(inputs).toHaveLength(0);
      });
    });
  });
});
