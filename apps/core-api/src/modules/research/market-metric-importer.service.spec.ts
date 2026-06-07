import {
  MarketMetricImporter,
  MARKET_METRIC_TYPE,
  BRAND_SHARE_TYPE,
  MODEL_METRIC_TYPE,
  AVC_REPORT_TYPE,
} from './market-metric-importer.service';
import { ModelMetricRow } from './avc-template-extractor';

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

describe('MarketMetricImporter — model_metric (sheet 2-7, ADR-0043)', () => {
  let h: ReturnType<typeof makeHarness>;

  const row = (over: Partial<ModelMetricRow> = {}): ModelMetricRow => ({
    category: '电饭煲',
    model: 'SF40HC782',
    brand: '苏泊尔',
    heating: 'IH加热',
    launchDate: '23.10',
    reservation: '有',
    month: '26.04',
    valueShare: 0.0200989687,
    volumeShare: 0.0079030185,
    avgPrice: 709.48,
    sourceReport: 'dianfanbao-full.xlsx',
    ...over,
  });

  beforeEach(() => { h = makeHarness(); });

  it('creates the model_metric Object Type with numeric shares sortable and key dims filterable', async () => {
    await h.importer.importModels('t1', [row()]);
    const def = h.createdDefs.find((d) => d.name === MODEL_METRIC_TYPE);
    expect(def).toBeDefined();
    const byName = Object.fromEntries(def.properties.map((p: any) => [p.name, p]));
    expect(byName.valueShare).toMatchObject({ type: 'number', sortable: true });
    expect(byName.volumeShare).toMatchObject({ type: 'number', sortable: true });
    expect(byName.avgPrice).toMatchObject({ type: 'number', sortable: true });
    expect(byName.category.filterable).toBe(true);
    expect(byName.brand.filterable).toBe(true);
    expect(byName.month.filterable).toBe(true);
    expect(byName.launchDate.filterable).toBe(true);
  });

  it('keys each instance by 品类_机型_月份 so re-ingest upserts in place', async () => {
    await h.importer.importModels('t1', [row()]);
    expect(h.upserts[0].objectType).toBe(MODEL_METRIC_TYPE);
    expect(h.upserts[0].instances[0].externalId).toBe('电饭煲_SF40HC782_26.04');
  });

  it('carries the SKU attributes and per-month share/price into properties', async () => {
    await h.importer.importModels('t1', [row()]);
    expect(h.upserts[0].instances[0].properties).toMatchObject({
      category: '电饭煲',
      model: 'SF40HC782',
      brand: '苏泊尔',
      heating: 'IH加热',
      launchDate: '23.10',
      month: '26.04',
      valueShare: 0.0200989687,
      volumeShare: 0.0079030185,
      avgPrice: 709.48,
    });
  });

  it('emits one instance per (SKU, month) row', async () => {
    await h.importer.importModels('t1', [
      row({ month: '26.03', avgPrice: 700 }),
      row({ month: '26.04', avgPrice: 709.48 }),
    ]);
    expect(h.upserts[0].instances).toHaveLength(2);
    expect(h.upserts[0].instances.map((i: any) => i.externalId)).toEqual([
      '电饭煲_SF40HC782_26.03',
      '电饭煲_SF40HC782_26.04',
    ]);
  });

  it('does not recreate the Object Type when it already exists (idempotent ensure)', async () => {
    h.existingTypes.add(MODEL_METRIC_TYPE);
    await h.importer.importModels('t1', [row()]);
    expect(h.fakeOntology.createObjectType).not.toHaveBeenCalled();
    expect(h.upserts[0].instances).toHaveLength(1);
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

describe('MarketMetricImporter.importReport — one report = four writes (ADR-0043)', () => {
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

  it('writes all four object types from a single call', async () => {
    await h.importer.importReport('t1', report());
    const types = h.upserts.map((u) => u.objectType).sort();
    expect(types).toEqual(
      [MARKET_METRIC_TYPE, BRAND_SHARE_TYPE, MODEL_METRIC_TYPE, AVC_REPORT_TYPE].sort(),
    );
  });

  it('returns per-type counts matching the input row counts', async () => {
    const result = await h.importer.importReport('t1', report());
    expect(result.metrics).toBe(1);
    expect(result.brandShares).toBe(1);
    expect(result.modelMetrics).toBe(1);
    expect(result.objectType).toBe(MARKET_METRIC_TYPE);
  });

  it('stamps the coverage provenance row with the report period and coverage', async () => {
    await h.importer.importReport('t1', report());
    const cov = h.upserts.find((u) => u.objectType === AVC_REPORT_TYPE)!.instances[0];
    expect(cov.externalId).toBe('dianfanbao-full.xlsx');
    expect(cov.properties).toMatchObject({ category: '电饭煲', period: '26.04', coverage: 'full' });
  });
});

