import { SemanticSearchService } from './semantic-search.service';
import { EmbeddingClient } from './embedding/embedding-client.interface';

// Deterministic fake embedder — records the query it was asked to embed.
class FakeEmbedder implements EmbeddingClient {
  public lastQuery?: string;
  async embedPassages(texts: string[]): Promise<number[][]> {
    return texts.map(() => [0, 0, 0, 0]);
  }
  async embedQuery(text: string): Promise<number[]> {
    this.lastQuery = text;
    return [0.1, 0.2, 0.3, 0.4];
  }
}

describe('SemanticSearchService', () => {
  let service: SemanticSearchService;
  let embedder: FakeEmbedder;
  let capturedSql: string;
  let capturedParams: unknown[];

  const sampleRow = {
    text: '高端用户更看重龙头颜值与极致体验。',
    category: '净水器',
    priceBand: null,
    page: 61,
    documentId: 'doc-1',
    title: '净水器人群调研',
    agency: '品创方略',
    quarter: '2025Q2',
    mediaRef: 'ref-1',
    distance: 0.12,
  };

  const mockPrisma: any = {
    $queryRawUnsafe: jest.fn(async (sql: string, ...params: unknown[]) => {
      capturedSql = sql;
      capturedParams = params;
      return [sampleRow];
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    embedder = new FakeEmbedder();
    service = new SemanticSearchService(mockPrisma, embedder);
  });

  it('embeds the query with the query (not passage) path', async () => {
    await service.search('t1', '净水器高端用户最关注什么', {}, 5);
    expect(embedder.lastQuery).toBe('净水器高端用户最关注什么');
  });

  it('scopes the search to the tenant and the chunk table', async () => {
    await service.search('t1', 'q', {}, 5);
    expect(capturedSql).toContain('document_chunks');
    expect(capturedParams).toContain('t1');
  });

  it('applies the 品类 pre-filter when a category is given', async () => {
    await service.search('t1', 'q', { category: '净水器' }, 5);
    expect(capturedSql).toContain('category');
    expect(capturedParams).toContain('净水器');
  });

  it('omits the category filter when no category is given', async () => {
    await service.search('t1', 'q', {}, 5);
    expect(capturedParams).not.toContain('净水器');
  });

  it('applies the 价格段 pre-filter when a price band is given', async () => {
    await service.search('t1', 'q', { category: '电饭煲', priceBand: '400-699' }, 5);
    expect(capturedSql).toContain('price_band');
    expect(capturedParams).toContain('400-699');
  });

  it('passes k as the LIMIT', async () => {
    await service.search('t1', 'q', {}, 3);
    expect(capturedParams).toContain(3);
  });

  it('ranks by vector distance to the embedded query', async () => {
    await service.search('t1', 'q', {}, 5);
    expect(capturedSql).toContain('<=>');
    expect(capturedSql.toUpperCase()).toContain('ORDER BY');
  });

  it('maps each row to a scored chunk carrying provenance (document + page)', async () => {
    const results = await service.search('t1', 'q', {}, 5);
    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r.text).toBe(sampleRow.text);
    expect(r.distance).toBe(0.12);
    expect(r.provenance).toEqual({
      documentId: 'doc-1',
      title: '净水器人群调研',
      agency: '品创方略',
      quarter: '2025Q2',
      page: 61,
    });
  });
});
