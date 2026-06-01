import { ArkEmbeddingClient } from './ark-embedding-client';
import { EMBEDDING_DIM } from './embedding-client.interface';

describe('ArkEmbeddingClient', () => {
  let client: ArkEmbeddingClient;
  let mockFetch: jest.Mock;

  // A raw embedding the fake API returns, length EMBEDDING_DIM (so truncation is a no-op here).
  const rawVec = (seed: number) => Array.from({ length: EMBEDDING_DIM }, (_, i) => seed + i * 0.001);

  beforeEach(() => {
    process.env.ARK_API_KEY = 'test-key';
    mockFetch = jest.fn();
    global.fetch = mockFetch as any;
    client = new ArkEmbeddingClient();
  });

  afterEach(() => {
    delete process.env.ARK_API_KEY;
  });

  function mockEmbeddings(vectors: number[][]) {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: vectors.map((embedding, index) => ({ index, embedding })) }),
    });
  }

  it('embeds passages raw (no instruction prefix) and returns one vector per input', async () => {
    mockEmbeddings([rawVec(1), rawVec(2)]);
    const out = await client.embedPassages(['段落一', '段落二']);
    expect(out).toHaveLength(2);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.input).toEqual(['段落一', '段落二']);
    expect(body.model).toContain('doubao-embedding');
  });

  it('prefixes a query with the retrieval instruction', async () => {
    mockEmbeddings([rawVec(1)]);
    await client.embedQuery('空气炸锅用户痛点');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.input[0]).toContain('Query: 空气炸锅用户痛点');
    expect(body.input[0]).toContain('Instruct:');
  });

  it('L2-normalizes returned vectors (unit length)', async () => {
    mockEmbeddings([rawVec(1)]);
    const [vec] = await client.embedPassages(['x']);
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('truncates an over-long embedding to EMBEDDING_DIM', async () => {
    const tooLong = Array.from({ length: EMBEDDING_DIM + 512 }, (_, i) => 1 + i);
    mockEmbeddings([tooLong]);
    const [vec] = await client.embedPassages(['x']);
    expect(vec).toHaveLength(EMBEDDING_DIM);
  });

  it('preserves input order even if the API returns items out of order', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { index: 1, embedding: rawVec(20) },
          { index: 0, embedding: rawVec(10) },
        ],
      }),
    });
    const out = await client.embedPassages(['first', 'second']);
    // out[0] must correspond to index 0 (seed 10), not the first returned item.
    expect(out[0][0]).toBeCloseTo(normalizeFirst(rawVec(10)), 5);
  });

  it('throws on a non-ok API response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'bad key' });
    await expect(client.embedPassages(['x'])).rejects.toThrow(/401/);
  });

  it('returns an empty array without calling the API for no passages', async () => {
    expect(await client.embedPassages([])).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

/** First component of the L2-normalized vector, for the order assertion. */
function normalizeFirst(vec: number[]): number {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return vec[0] / norm;
}
