import { ResearchSdk } from './research.sdk';
import { CurrentUser } from '@omaha/shared-types';

const INGEST_USER: CurrentUser = {
  id: 'u1', email: 'a@a', name: 'A', tenantId: 't1', roleId: 'r1',
  roleName: 'admin', permissions: ['*'], permissionRules: [{ permission: '*' }],
};

const NO_PERM_USER: CurrentUser = {
  id: 'u2', email: 'b@b', name: 'B', tenantId: 't1', roleId: 'r2',
  roleName: 'viewer', permissions: [], permissionRules: [],
};

function makeHarness() {
  const invalidated: string[] = [];
  const fakeOntologySdk: any = {
    invalidate: jest.fn((tid: string) => invalidated.push(tid)),
  };
  // Post-cutover (#175): the SDK routes the data stars through AvcConnector.fetch() (3 raw
  // Datasets + reactive Pipelines) and writes ONLY the coverage provenance via the importer.
  const fakeConnector: any = {
    fetch: jest.fn().mockResolvedValue({
      datasets: [
        { star: 'market_metric', datasetId: 'ds-m', connectorId: 'c-m', rowCount: 3 },
        { star: 'brand_share', datasetId: 'ds-b', connectorId: 'c-b', rowCount: 2 },
        { star: 'model_metric', datasetId: 'ds-o', connectorId: 'c-o', rowCount: 5 },
      ],
      coverage: 'full', sourceReport: 'test.xlsx', category: '电饭煲', period: '26.04',
    }),
  };
  const fakeImporter: any = {
    importReportCoverage: jest.fn().mockResolvedValue({ objectType: 'avc_report', imported: 1, skipped: 0 }),
  };
  const fakeDocIngestion: any = {
    ingest: jest.fn().mockResolvedValue({ chunks: 10 }),
  };
  const fakeSearch: any = {
    search: jest.fn().mockResolvedValue([{ text: 'found', score: 0.9 }]),
  };

  const sdk = new ResearchSdk(fakeOntologySdk, fakeConnector, fakeImporter, fakeDocIngestion, fakeSearch);

  return { sdk, invalidated, fakeOntologySdk, fakeConnector, fakeImporter, fakeDocIngestion, fakeSearch };
}

describe('ResearchSdk.extractAvcReport', () => {
  it('rejects actors without data.ingest capability', async () => {
    const { sdk } = makeHarness();
    await expect(sdk.extractAvcReport(NO_PERM_USER, { fileId: 'f1', category: '电饭煲' }))
      .rejects.toThrow();
  });

  it('routes the data stars through AvcConnector.fetch() and writes coverage via the importer', async () => {
    const { sdk, fakeConnector, fakeImporter } = makeHarness();
    const result = await sdk.extractAvcReport(INGEST_USER, { fileId: 'f1', category: '电饭煲' });
    // Cutover: stars flow through the connector's raw-Dataset fan-out, not importReport().
    expect(fakeConnector.fetch).toHaveBeenCalledWith('t1', expect.objectContaining({ category: '电饭煲' }));
    // Coverage provenance is still written directly (ADR-0043 §2).
    expect(fakeImporter.importReportCoverage).toHaveBeenCalledWith('t1', expect.objectContaining({
      sourceReport: 'test.xlsx', category: '电饭煲', period: '26.04', coverage: 'full',
    }));
    expect(result.coverage).toBe('full');
    // Reported counts come from the raw Dataset row counts (3+2+5), now enqueued for async cleaning.
    expect(result.imported).toBe(10);
  });

  it('invalidates cache after successful AVC ingestion', async () => {
    const { sdk, invalidated } = makeHarness();
    await sdk.extractAvcReport(INGEST_USER, { fileId: 'f1', category: '电饭煲' });
    expect(invalidated).toContain('t1');
  });
});

describe('ResearchSdk.ingestDocument', () => {
  it('rejects actors without data.ingest capability', async () => {
    const { sdk } = makeHarness();
    await expect(sdk.ingestDocument(NO_PERM_USER, {
      fileId: 'f2', originalName: 'report.pdf', metadata: { category: '净水器' },
    })).rejects.toThrow();
  });

  it('delegates to DocumentIngestionService', async () => {
    const { sdk, fakeDocIngestion } = makeHarness();
    await sdk.ingestDocument(INGEST_USER, {
      fileId: 'f2', originalName: 'report.pdf', metadata: { category: '净水器' },
    });
    expect(fakeDocIngestion.ingest).toHaveBeenCalledWith('t1', expect.stringContaining('f2'), 'report.pdf', { category: '净水器' });
  });
});

describe('ResearchSdk.searchResearch', () => {
  it('delegates to SemanticSearchService and returns scored chunks', async () => {
    const { sdk, fakeSearch } = makeHarness();
    const result = await sdk.searchResearch(INGEST_USER, { query: '用户怎么说', category: '净水器' });
    expect(fakeSearch.search).toHaveBeenCalledWith('t1', '用户怎么说', { category: '净水器', priceBand: undefined }, 6);
    expect(result).toHaveLength(1);
  });
});
