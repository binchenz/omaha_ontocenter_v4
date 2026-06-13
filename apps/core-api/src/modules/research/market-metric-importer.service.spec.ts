import {
  MarketMetricImporter,
  MARKET_METRIC_TYPE,
  BRAND_SHARE_TYPE,
  MODEL_METRIC_TYPE,
  AVC_REPORT_TYPE,
  MODEL_METRIC_DEF,
} from './market-metric-importer.service';

// Capture what the importer asks the single write path to upsert, and which Object
// Type defs it ensures. The importer is a thin mapper over ImportEngine.importInstances;
// the behavior worth pinning is the externalId/property contract and the type defs.
type Captured = { tenantId: string; objectType: string; instances: any[] };

/** Shared fake collaborators — re-created each test via makeHarness() so jest.clearAllMocks()
 *  doesn't need to be called across describe boundaries. Each describe calls makeHarness()
 *  in its own beforeEach so state is always fresh. */
function makeHarness() {
  const upserts: Captured[] = [];
  const createdDefs: any[] = [];
  const existingTypes: Set<string> = new Set();

  const fakeImportEngine: any = {
    importInstances: jest.fn(async (tenantId: string, objectType: string, instances: any[]) => {
      upserts.push({ tenantId, objectType, instances });
      return { imported: instances.length, skipped: 0, objectType };
    }),
  };
  const fakeOntology: any = {
    createObjectType: jest.fn(async (_t: string, def: any) => {
      createdDefs.push(def);
      existingTypes.add(def.name);
    }),
  };
  const fakePrisma: any = {
    objectType: {
      findFirst: jest.fn(async ({ where }: any) =>
        existingTypes.has(where.name) ? { id: where.name } : null,
      ),
    },
    objectMapping: {
      findFirst: jest.fn(async () => null),
    },
  };

  const fakeDatasetService: any = {};
  const fakeSyncJobService: any = {};

  const importer = new MarketMetricImporter(fakePrisma, fakeOntology, fakeImportEngine, fakeDatasetService, fakeSyncJobService);
  return { importer, upserts, createdDefs, existingTypes, fakeOntology };
}

describe('MODEL_METRIC_DEF — model_metric Object Type shape (ADR-0043)', () => {
  // After the #175 cutover the importer no longer writes model_metric instances (the
  // Pipeline path does). The DEF is now exported so the provisioner can ensure the
  // ObjectType; its shape is still the contract worth pinning.
  it('declares numeric shares sortable and key dims filterable', () => {
    const byName = Object.fromEntries(MODEL_METRIC_DEF.properties.map((p: any) => [p.name, p]));
    expect(byName.valueShare).toMatchObject({ type: 'number', sortable: true });
    expect(byName.volumeShare).toMatchObject({ type: 'number', sortable: true });
    expect(byName.avgPrice).toMatchObject({ type: 'number', sortable: true });
    expect(byName.category.filterable).toBe(true);
    expect(byName.brand.filterable).toBe(true);
    expect(byName.month.filterable).toBe(true);
    expect(byName.launchDate.filterable).toBe(true);
  });

  it('names the type model_metric', () => {
    expect(MODEL_METRIC_DEF.name).toBe(MODEL_METRIC_TYPE);
  });
});

describe('MarketMetricImporter — avc_report coverage provenance (ADR-0043 §2)', () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => { h = makeHarness(); });

  it('records coverage on a per-report provenance row keyed by the report file', async () => {
    await h.importer.importReportCoverage('t1', {
      sourceReport: 'dianfanbao-full.xlsx',
      category: '电饭煲',
      period: '26.04',
      coverage: 'full',
    });
    expect(h.upserts[0].objectType).toBe(AVC_REPORT_TYPE);
    const inst = h.upserts[0].instances[0];
    expect(inst.externalId).toBe('dianfanbao-full.xlsx');
    expect(inst.properties).toMatchObject({
      category: '电饭煲',
      period: '26.04',
      coverage: 'full',
      sourceReport: 'dianfanbao-full.xlsx',
    });
  });

  it('creates the avc_report Object Type with coverage and period filterable', async () => {
    await h.importer.importReportCoverage('t1', {
      sourceReport: 'kongqizhaguo-essence.xlsx',
      category: '空气炸锅',
      period: '26.04',
      coverage: 'essence',
    });
    const def = h.createdDefs.find((d) => d.name === AVC_REPORT_TYPE);
    expect(def).toBeDefined();
    const byName = Object.fromEntries(def.properties.map((p: any) => [p.name, p]));
    expect(byName.coverage.filterable).toBe(true);
    expect(byName.period.filterable).toBe(true);
    expect(byName.category.filterable).toBe(true);
  });
});

describe('MarketMetricImporter.importReport — coverage-only after #175 cutover (ADR-0055 Step 5)', () => {
  let h: ReturnType<typeof makeHarness>;

  const report = () => ({
    category: '电饭煲',
    period: '26.04',
    coverage: 'full' as const,
    sourceReport: 'dianfanbao-full.xlsx',
    metrics: [
      { category: '电饭煲', month: '26.04', metric: '零售额', value: 100, sourceReport: 'dianfanbao-full.xlsx' },
    ],
    brandShares: [
      { category: '电饭煲', brand: '苏泊尔', priceBand: '整体', period: '26.04', metric: 'share', value: 0.27, sourceReport: 'dianfanbao-full.xlsx' },
    ],
    modelMetrics: [
      { category: '电饭煲', model: 'SF40HC782', brand: '苏泊尔', heating: 'IH加热', launchDate: '23.10', reservation: '有', month: '26.04', valueShare: 0.02, volumeShare: 0.008, avgPrice: 709.48, sourceReport: 'dianfanbao-full.xlsx' },
    ],
  });

  beforeEach(() => { h = makeHarness(); });

  it('writes ONLY the avc_report coverage row — the three stars now flow through Pipelines', async () => {
    await h.importer.importReport('t1', report());
    // Cutover: importStar deleted. The market/brand/model stars are produced by the
    // Connector → Pipeline → SyncJob chain, NOT here. Only coverage provenance stays direct (ADR-0043 §2).
    const types = h.upserts.map((u) => u.objectType);
    expect(types).toEqual([AVC_REPORT_TYPE]);
    expect(types).not.toContain(MARKET_METRIC_TYPE);
    expect(types).not.toContain(BRAND_SHARE_TYPE);
    expect(types).not.toContain(MODEL_METRIC_TYPE);
  });

  it('stamps the coverage provenance row with the report period and coverage', async () => {
    await h.importer.importReport('t1', report());
    const cov = h.upserts.find((u) => u.objectType === AVC_REPORT_TYPE)!.instances[0];
    expect(cov.externalId).toBe('dianfanbao-full.xlsx');
    expect(cov.properties).toMatchObject({ category: '电饭煲', period: '26.04', coverage: 'full' });
  });

  it('returns zero star counts and reports avc_report as the head objectType (coverage-only)', async () => {
    const result = await h.importer.importReport('t1', report());
    // Stars are no longer counted here (they are async via Pipelines); the shape stays stable for callers.
    expect(result.metrics).toBe(0);
    expect(result.brandShares).toBe(0);
    expect(result.modelMetrics).toBe(0);
    // avc_report is the only write this method still performs post-cutover.
    expect(result.objectType).toBe(AVC_REPORT_TYPE);
  });
});

