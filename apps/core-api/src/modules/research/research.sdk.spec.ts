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
  const fakeExtractor: any = {
    extractAll: jest.fn().mockResolvedValue({
      category: '电饭煲', period: '26.04', coverage: 'full', sourceReport: 'test.xlsx',
      metrics: [], brandShares: [], modelMetrics: [],
    }),
  };
  const fakeImporter: any = {
    importReport: jest.fn().mockResolvedValue({
      objectType: 'market_metric', metrics: 3, brandShares: 2, modelMetrics: 5,
    }),
  };
  const fakeDocIngestion: any = {
    ingest: jest.fn().mockResolvedValue({ chunks: 10 }),
  };
  const fakeSearch: any = {
    search: jest.fn().mockResolvedValue([{ text: 'found', score: 0.9 }]),
  };

  const sdk = new ResearchSdk(fakeOntologySdk, fakeExtractor, fakeImporter, fakeDocIngestion, fakeSearch);

  return { sdk, invalidated, fakeOntologySdk, fakeExtractor, fakeImporter, fakeDocIngestion, fakeSearch };
}

describe('ResearchSdk.extractAvcReport', () => {
  it('rejects actors without data.ingest capability', async () => {
    const { sdk } = makeHarness();
    await expect(sdk.extractAvcReport(NO_PERM_USER, { fileId: 'f1', category: '电饭煲' }))
      .rejects.toThrow();
  });

  it('calls extractor + importer and returns merged counts', async () => {
    const { sdk, fakeExtractor, fakeImporter } = makeHarness();
    const result = await sdk.extractAvcReport(INGEST_USER, { fileId: 'f1', category: '电饭煲' });
    expect(fakeExtractor.extractAll).toHaveBeenCalled();
    expect(fakeImporter.importReport).toHaveBeenCalled();
    expect(result.metrics).toBe(3);
    expect(result.coverage).toBe('full');
    expect(result.imported).toBe(10); // 3+2+5
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
