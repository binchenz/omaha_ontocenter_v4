import { AvcPipelineProvisioner } from './avc-pipeline-provisioner.service';

const T = 'tenant-1';

/**
 * The three fixed AVC pipelines (ADR-0055 Step 2). Names are stable so idempotency
 * can key off them and the cutover (#175) can find them by name.
 */
const PIPELINE_NAMES = ['avc_market_metric', 'avc_brand_share', 'avc_model_metric'];

function make(seed: { connectors?: any[]; objectTypes?: any[]; pipelines?: any[]; configs?: any[]; mappings?: any[] } = {}) {
  const connectors: any[] = seed.connectors ?? [];
  // Default: ObjectTypes already exist (the common case — a tenant that has ingested AVC before).
  // Tests that exercise the ensure path pass `objectTypes: []`.
  const objectTypes: any[] =
    seed.objectTypes ??
    [
      { id: 'ot-mm', tenantId: T, name: 'market_metric' },
      { id: 'ot-bs', tenantId: T, name: 'brand_share' },
      { id: 'ot-mo', tenantId: T, name: 'model_metric' },
    ];
  const pipelines: any[] = seed.pipelines ?? [];
  const configs: any[] = seed.configs ?? [];
  const mappings: any[] = seed.mappings ?? [];
  let seq = 0;

  const prisma: any = {
    connector: {
      findFirst: jest.fn(async ({ where }: any) =>
        connectors.find((c) => c.tenantId === where.tenantId && c.type === where.type) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const c = { id: `conn-${++seq}`, ...data };
        connectors.push(c);
        return c;
      }),
    },
    objectType: {
      findFirst: jest.fn(async ({ where }: any) =>
        objectTypes.find((o) => o.tenantId === where.tenantId && o.name === where.name) ?? null,
      ),
    },
    objectMapping: {
      findFirst: jest.fn(async ({ where }: any) =>
        mappings.find(
          (m) =>
            m.tenantId === where.tenantId &&
            m.objectTypeId === where.objectTypeId &&
            (where.connectorId === undefined || m.connectorId === where.connectorId),
        ) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const m = { id: `map-${++seq}`, ...data };
        mappings.push(m);
        return m;
      }),
    },
    pipeline: {
      findFirst: jest.fn(async ({ where }: any) =>
        pipelines.find(
          (p) =>
            p.tenantId === where.tenantId &&
            p.connectorId === where.connectorId &&
            p.outputObjectTypeId === where.outputObjectTypeId,
        ) ?? null,
      ),
      findMany: jest.fn(async ({ where }: any) =>
        pipelines.filter(
          (p) =>
            p.tenantId === where.tenantId &&
            (where.name?.in ? where.name.in.includes(p.name) : true) &&
            (where.status === undefined ? true : p.status === where.status),
        ),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const p = pipelines.find((x) => x.id === where.id)!;
        Object.assign(p, data);
        return p;
      }),
    },
  };

  // OntologyService: createObjectType pushes a new ObjectType (so a fresh tenant can provision).
  const ensuredDefs: any[] = [];
  const ontologyService: any = {
    createObjectType: jest.fn(async (tenantId: string, def: any) => {
      ensuredDefs.push(def);
      const ot = { id: `ot-${++seq}`, tenantId, name: def.name };
      objectTypes.push(ot);
      return ot;
    }),
  };

  // PipelineService.configurePipeline records the created pipelines (and pushes into the
  // shared `pipelines` array so a subsequent provision() sees them as existing).
  const configureCalls: any[] = [];
  const pipelineService: any = {
    configurePipeline: jest.fn(async (tenantId: string, dto: any) => {
      configureCalls.push({ tenantId, dto });
      const p = {
        id: `p-${++seq}`,
        tenantId,
        name: dto.name,
        connectorId: dto.connectorId,
        outputObjectTypeId: dto.outputObjectTypeId,
        status: dto.autoActivate ? 'active' : 'draft',
      };
      pipelines.push(p);
      return { pipelineId: p.id, status: p.status };
    }),
  };

  // TransformConfigService: get() throws when missing (seed-on-miss), create() appends a version.
  const createCalls: any[] = [];
  const transformConfigService: any = {
    get: jest.fn(async (tenantId: string, name: string, version?: number) => {
      const matches = configs.filter((c) => c.tenantId === tenantId && c.name === name);
      if (matches.length === 0) throw new Error(`TransformConfig ${name} not found`);
      return matches.reduce((a, b) => (b.version > a.version ? b : a));
    }),
    create: jest.fn(async (tenantId: string, dto: any) => {
      createCalls.push({ tenantId, dto });
      const latest = configs.filter((c) => c.tenantId === tenantId && c.name === dto.name);
      const version = (latest.reduce((m, c) => Math.max(m, c.version), 0) || 0) + 1;
      const c = { id: `tc-${++seq}`, tenantId, name: dto.name, type: dto.type, config: dto.config, version };
      configs.push(c);
      return c;
    }),
  };

  return {
    provisioner: new AvcPipelineProvisioner(prisma, pipelineService, transformConfigService, ontologyService),
    prisma,
    connectors,
    pipelines,
    configs,
    mappings,
    pipelineService,
    transformConfigService,
    ontologyService,
    ensuredDefs,
    configureCalls,
    createCalls,
  };
}

describe('AvcPipelineProvisioner (#174, ADR-0055 Step 2)', () => {
  it('creates the 3 fixed AVC pipelines for a tenant, active on creation (Phase 5 cutover)', async () => {
    const { provisioner, pipelines, configureCalls } = make();
    const res = await provisioner.provision(T);

    expect(res.created.sort()).toEqual([...PIPELINE_NAMES].sort());
    expect(res.skipped).toEqual([]);
    expect(pipelines).toHaveLength(3);
    // Cutover complete (ADR-0055 Step 5): every pipeline is created with autoActivate:true so
    // markReady triggers runs immediately — the reactive chain is now the live AVC path.
    for (const call of configureCalls) {
      expect(call.dto.autoActivate).toBe(true);
    }
  });

  it('seeds the brand_mapping TransformConfig so compute steps resolve', async () => {
    const { provisioner, configs, createCalls } = make();
    await provisioner.provision(T);
    const types = configs.map((c) => c.type).sort();
    expect(types).toContain('brand_mapping');
    expect(createCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('does not re-seed a TransformConfig that already exists', async () => {
    const { provisioner, transformConfigService } = make({
      configs: [
        { tenantId: T, name: 'avc_brands', type: 'brand_mapping', version: 4, config: { mappings: {} } },
      ],
    });
    await provisioner.provision(T);
    expect(transformConfigService.create).not.toHaveBeenCalled();
  });

  it('reuses existing per-star connectors rather than creating duplicates', async () => {
    // Per-star routing (ADR-0055 amendment): one connector per star so onRawDatasetReady
    // resolves exactly one active pipeline per connector. Pre-seed all three.
    const { provisioner, prisma, connectors } = make({
      connectors: [
        { id: 'conn-mm', tenantId: T, type: 'avc_market_excel', name: 'AVC 市场指标' },
        { id: 'conn-bs', tenantId: T, type: 'avc_brand_excel', name: 'AVC 品牌份额' },
        { id: 'conn-mo', tenantId: T, type: 'avc_model_excel', name: 'AVC 机型指标' },
      ],
    });
    await provisioner.provision(T);
    expect(prisma.connector.create).not.toHaveBeenCalled();
    expect(connectors).toHaveLength(3);
  });

  it('creates one connector per star (3 distinct connectors) when none exist', async () => {
    const { provisioner, connectors } = make();
    await provisioner.provision(T);
    expect(connectors).toHaveLength(3);
    expect(connectors.map((c) => c.type).sort()).toEqual(
      ['avc_brand_excel', 'avc_market_excel', 'avc_model_excel'],
    );
  });

  it('binds each pipeline to its own star connector (distinct connectorIds)', async () => {
    const { provisioner, configureCalls } = make();
    await provisioner.provision(T);
    const connectorIds = configureCalls.map((c) => c.dto.connectorId);
    expect(new Set(connectorIds).size).toBe(3); // no two pipelines share a connector
  });

  it('is idempotent — a second run creates nothing and reports all skipped', async () => {
    const ctx = make();
    await ctx.provisioner.provision(T);
    ctx.pipelineService.configurePipeline.mockClear();

    const res2 = await ctx.provisioner.provision(T);
    expect(res2.created).toEqual([]);
    expect(res2.skipped.sort()).toEqual([...PIPELINE_NAMES].sort());
    expect(ctx.pipelineService.configurePipeline).not.toHaveBeenCalled();
    expect(ctx.pipelines).toHaveLength(3);
  });

  it('wires the brand_share pipeline with a normalize_brand compute step', async () => {
    const { provisioner, configureCalls } = make();
    await provisioner.provision(T);
    const brandShare = configureCalls.find((c) => c.dto.name === 'avc_brand_share')!;
    const compute = brandShare.dto.steps.find((s: any) => s.type === 'compute' && s.config.function === 'normalize_brand');
    expect(compute.config.function).toBe('normalize_brand');
    expect(compute.config.configRef).toBe('avc_brands');
  });

  it('wires the brand_share pipeline to re-key + merge-sum after normalization (#177 gap ③)', async () => {
    // After normalize_brand rewrites `brand`, the upstream-baked externalId is stale (still
    // carries the dirty brand). A `concat` step re-derives externalId from the normalized fields,
    // then an `aggregate` step groups by it and SUMs `value` so colliding variants merge instead
    // of landing as two coexisting rows (SyncJob upserts on externalId).
    const { provisioner, configureCalls } = make();
    await provisioner.provision(T);
    const steps = configureCalls.find((c) => c.dto.name === 'avc_brand_share')!.dto.steps;
    const orders = steps.map((s: any) => s.type);
    expect(orders).toEqual(['compute', 'compute', 'aggregate']); // normalize → concat → merge-sum

    const concat = steps.find((s: any) => s.config.function === 'concat');
    expect(concat.config.fields).toEqual(['category', 'brand', 'priceBand', 'period']);
    expect(concat.config.outputField).toBe('externalId');

    const agg = steps.find((s: any) => s.type === 'aggregate');
    expect(agg.config.groupBy).toContain('externalId');
    expect(agg.config.groupBy).toContain('brand');
    expect(agg.config.metrics).toContainEqual({ op: 'sum', field: 'value', as: 'value' });
  });

  it('wires the model_metric pipeline with a normalize_brand step (#177 gap ②)', async () => {
    // model_metric externalId = category_model_month (no brand) → renaming brand never collides,
    // so model_metric needs ONLY normalize_brand (no re-key / merge-sum). It must reference the
    // same avc_brands config so both stars normalize consistently.
    const { provisioner, configureCalls } = make();
    await provisioner.provision(T);
    const modelMetric = configureCalls.find((c) => c.dto.name === 'avc_model_metric')!;
    const compute = modelMetric.dto.steps.find((s: any) => s.type === 'compute');
    expect(compute.config.function).toBe('normalize_brand');
    expect(compute.config.configRef).toBe('avc_brands');
    expect(modelMetric.dto.steps.filter((s: any) => s.type === 'aggregate')).toHaveLength(0);
  });

  it('seeds a non-empty brand alias dictionary (#177 gap ①)', async () => {
    const { provisioner, createCalls } = make();
    await provisioner.provision(T);
    const brandSeed = createCalls.find((c) => c.dto.name === 'avc_brands')!;
    expect(Object.keys(brandSeed.dto.config.mappings).length).toBeGreaterThan(0);
    // Confirmed same-brand variants (user-approved 2026-06-15); 东菱星 deliberately NOT merged.
    expect(brandSeed.dto.config.mappings).toMatchObject({ 苏泊: '苏泊尔', 小米米家: '小米' });
    expect(brandSeed.dto.config.mappings).not.toHaveProperty('东菱星');
  });

  it('ensures the 3 star ObjectTypes when absent (fresh tenant, no prior importStar run)', async () => {
    // Gap #2 (cutover): importStar used to create these lazily. The Pipeline write path
    // (SyncJobWorker → ImportEngine) requires the ObjectType to pre-exist, so the provisioner
    // must ensure them.
    const { provisioner, ensuredDefs } = make({ objectTypes: [] });
    await provisioner.provision(T);
    expect(ensuredDefs.map((d) => d.name).sort()).toEqual(
      ['brand_share', 'market_metric', 'model_metric'],
    );
  });

  it('does not recreate ObjectTypes that already exist', async () => {
    const { provisioner, ontologyService } = make(); // default: all 3 exist
    await provisioner.provision(T);
    expect(ontologyService.createObjectType).not.toHaveBeenCalled();
  });

  it('creates an identity ObjectMapping per star (gap #1 — else SyncJob silently skips)', async () => {
    // onPipelineRunComplete looks up the mapping by (tenant, connectorId, outputObjectTypeId);
    // without it the clean rows never reach object_instances.
    const { provisioner, mappings } = make();
    await provisioner.provision(T);
    expect(mappings).toHaveLength(3);
    // Each mapping binds its star's per-star connector to the star ObjectType.
    const byObjectType = Object.fromEntries(mappings.map((m) => [m.objectTypeId, m]));
    expect(Object.keys(byObjectType)).toHaveLength(3);
    // Identity property map: brand_share maps `brand` → `brand` (the clean column the pipeline emits).
    for (const m of mappings) {
      expect(m.connectorId).toBeDefined();
      expect(typeof m.propertyMappings).toBe('object');
    }
  });

  it('does not duplicate an ObjectMapping that already exists', async () => {
    const ctx = make();
    await ctx.provisioner.provision(T);
    const countAfterFirst = ctx.mappings.length;
    ctx.prisma.objectMapping.create.mockClear();
    await ctx.provisioner.provision(T);
    expect(ctx.prisma.objectMapping.create).not.toHaveBeenCalled();
    expect(ctx.mappings).toHaveLength(countAfterFirst);
  });

  it('brand_share identity mapping carries brand so normalized brand syncs through', async () => {
    const { provisioner, mappings } = make();
    await provisioner.provision(T);
    // Find the brand_share mapping via the ObjectType id the default seed uses.
    const bs = mappings.find((m) => m.objectTypeId === 'ot-bs')!;
    expect(bs.propertyMappings).toMatchObject({ brand: 'brand' });
  });

  describe('activate (#175, ADR-0055 Step 4 — now a no-op safety net post-cutover)', () => {
    it('provision() leaves no drafts (autoActivate:true), so activate() flips nothing', async () => {
      const ctx = make();
      await ctx.provisioner.provision(T); // Phase 5: created already active
      for (const p of ctx.pipelines) expect(p.status).toBe('active');
      const res = await ctx.provisioner.activate(T);
      expect(res.activated).toEqual([]); // nothing left in draft to flip
    });

    it('is idempotent — re-running activate flips nothing new', async () => {
      const ctx = make();
      await ctx.provisioner.provision(T);
      await ctx.provisioner.activate(T);
      ctx.prisma.pipeline.update.mockClear();
      const res2 = await ctx.provisioner.activate(T);
      expect(res2.activated).toEqual([]);
      expect(ctx.prisma.pipeline.update).not.toHaveBeenCalled();
    });

    it('still flips a stray pre-existing draft AVC pipeline, leaving others untouched', async () => {
      // Defensive: if a draft AVC pipeline survives from a pre-cutover provision, activate()
      // must still flip it (it filters by status:'draft'), without touching unrelated pipelines.
      const ctx = make({
        pipelines: [
          { id: 'stray', tenantId: T, name: PIPELINE_NAMES[0], status: 'draft' },
          { id: 'other', tenantId: T, name: 'unrelated', status: 'draft' },
        ],
      });
      await ctx.provisioner.activate(T);
      expect(ctx.pipelines.find((p) => p.id === 'stray')!.status).toBe('active');
      expect(ctx.pipelines.find((p) => p.name === 'unrelated')!.status).toBe('draft'); // untouched
    });
  });
});
