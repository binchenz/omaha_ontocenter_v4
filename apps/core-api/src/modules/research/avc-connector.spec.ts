import { AvcConnector } from './avc-connector';
import { AVC_STARS } from './avc-stars';

const T = 'tenant-1';

const extraction = {
  category: '电饭煲',
  period: '26.04',
  coverage: 'full' as const,
  sourceReport: 'dianfanbao-full.xlsx',
  metrics: [
    { category: '电饭煲', month: '26.04', metric: '零售额', value: 100, sourceReport: 'dianfanbao-full.xlsx' },
    { category: '电饭煲', month: '26.04', metric: '零售量', value: 50, sourceReport: 'dianfanbao-full.xlsx' },
  ],
  brandShares: [
    { category: '电饭煲', brand: 'MIDEA', priceBand: '整体', period: '26.04', metric: 'share', value: 0.27, sourceReport: 'dianfanbao-full.xlsx' },
  ],
  modelMetrics: [
    { category: '电饭煲', model: 'SF40', brand: '苏泊尔', heating: 'IH', launchDate: '23.10', reservation: '有', month: '26.04', valueShare: 0.02, volumeShare: 0.008, avgPrice: 709.48, sourceReport: 'dianfanbao-full.xlsx' },
  ],
};

function make() {
  const extractor: any = { extractAll: jest.fn(async () => extraction) };

  // Per-star connectors keyed by type; find-or-create.
  const connectors: any[] = [];
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
  };

  // DatasetService: record created datasets + appended rows + markReady calls.
  const datasets: any[] = [];
  const appendCalls: any[] = [];
  const readyCalls: string[] = [];
  const datasetService: any = {
    createDataset: jest.fn(async (tenantId: string, dto: any) => {
      const d = { id: `ds-${++seq}`, tenantId, ...dto, kind: dto.kind ?? 'clean', rowCount: 0 };
      datasets.push(d);
      return d;
    }),
    appendRows: jest.fn(async (tenantId: string, datasetId: string, rows: any[]) => {
      appendCalls.push({ datasetId, rows });
      const d = datasets.find((x) => x.id === datasetId)!;
      d.rowCount += rows.length;
    }),
    markReady: jest.fn(async (tenantId: string, datasetId: string) => {
      readyCalls.push(datasetId);
      const d = datasets.find((x) => x.id === datasetId)!;
      d.status = 'ready';
      return d;
    }),
  };

  // Provisioner: idempotent pipeline setup, called at the start of fetch().
  const provisioner: any = {
    provision: jest.fn(async () => ({ created: [], skipped: [] })),
  };

  return {
    connector: new AvcConnector(extractor, prisma, datasetService, provisioner),
    extractor,
    prisma,
    connectors,
    datasets,
    appendCalls,
    readyCalls,
    datasetService,
    provisioner,
  };
}

describe('AvcConnector (#175 cutover, ADR-0055 Steps 3)', () => {
  it('has type avc_excel', () => {
    const { connector } = make();
    expect(connector.type).toBe('avc_excel');
  });

  it('fetch() delegates extraction to AvcTemplateExtractor.extractAll', async () => {
    const { connector, extractor } = make();
    await connector.fetch(T, { filePath: '/tmp/r.xlsx', category: '电饭煲' });
    expect(extractor.extractAll).toHaveBeenCalledWith('/tmp/r.xlsx', '电饭煲');
  });

  it('creates one raw Dataset per star (3 total), each kind=raw', async () => {
    const { connector, datasets } = make();
    await connector.fetch(T, { filePath: '/tmp/r.xlsx', category: '电饭煲' });
    expect(datasets).toHaveLength(3);
    for (const d of datasets) expect(d.kind).toBe('raw');
  });

  it('routes each star Dataset to its OWN per-star connector (3 distinct connectorIds)', async () => {
    const { connector, datasets, connectors } = make();
    await connector.fetch(T, { filePath: '/tmp/r.xlsx', category: '电饭煲' });
    expect(connectors).toHaveLength(3);
    expect(connectors.map((c) => c.type).sort()).toEqual(
      ['avc_brand_excel', 'avc_market_excel', 'avc_model_excel'],
    );
    // No two datasets share a connector → onRawDatasetReady fires exactly one pipeline each.
    expect(new Set(datasets.map((d) => d.connectorId)).size).toBe(3);
  });

  it('reuses an existing per-star connector instead of creating a duplicate', async () => {
    const ctx = make();
    await ctx.connector.fetch(T, { filePath: '/tmp/r.xlsx', category: '电饭煲' });
    ctx.prisma.connector.create.mockClear();
    // Second fetch: connectors already exist → no new creates.
    await ctx.connector.fetch(T, { filePath: '/tmp/r2.xlsx', category: '电饭煲' });
    expect(ctx.prisma.connector.create).not.toHaveBeenCalled();
    expect(ctx.connectors).toHaveLength(3);
  });

  it('appends the extracted rows (flat) and marks each Dataset ready to trigger its pipeline', async () => {
    const { connector, appendCalls, readyCalls, datasets } = make();
    await connector.fetch(T, { filePath: '/tmp/r.xlsx', category: '电饭煲' });
    // market has 2 metric rows, brand 1, model 1
    const byCount = appendCalls.map((c) => c.rows.length).sort();
    expect(byCount).toEqual([1, 1, 2]);
    // All three marked ready (each markReady reactively enqueues its PipelineRun).
    expect(readyCalls).toHaveLength(3);
    expect(readyCalls.sort()).toEqual(datasets.map((d) => d.id).sort());
    // Rows are flat: externalId hoisted, no nested `properties`.
    const marketAppend = appendCalls.find((c) => c.rows.some((r: any) => r.metric))!;
    expect(marketAppend.rows[0].externalId).toBeDefined();
    expect(marketAppend.rows[0].properties).toBeUndefined();
  });

  it('returns a summary of the 3 raw Datasets (not the parsed three-star structure)', async () => {
    const { connector } = make();
    const result: any = await connector.fetch(T, { filePath: '/tmp/r.xlsx', category: '电饭煲' });
    // Cutover: fetch no longer returns {metrics, brandShares, modelMetrics} rows.
    expect(result.metrics).toBeUndefined();
    expect(Array.isArray(result.datasets)).toBe(true);
    expect(result.datasets).toHaveLength(3);
    const stars = result.datasets.map((d: any) => d.star).sort();
    expect(stars).toEqual(AVC_STARS.map((s) => s.objectType).sort());
    expect(result.coverage).toBe('full'); // coverage still surfaced for the importer's provenance write
  });

  it('names each raw Dataset with its star prefix + category + period for lineage', async () => {
    const { connector, datasets } = make();
    await connector.fetch(T, { filePath: '/tmp/r.xlsx', category: '电饭煲' });
    const names = datasets.map((d) => d.name);
    expect(names.some((n) => n.includes('avc_market') && n.includes('电饭煲') && n.includes('26.04'))).toBe(true);
  });
});
