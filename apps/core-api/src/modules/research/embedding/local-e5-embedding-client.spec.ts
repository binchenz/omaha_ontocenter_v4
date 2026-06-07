import { LocalE5EmbeddingClient } from './local-e5-embedding-client';
import { EMBEDDING_DIM } from './embedding-client.interface';

/**
 * Offline contract test: the real transformers.js pipeline is replaced by a fake extractor that
 * records the prefixed inputs it was called with, so we assert the e5 query/passage asymmetry and
 * the dim handling without loading a 500MB model or hitting the network.
 */
describe('LocalE5EmbeddingClient', () => {
  let client: LocalE5EmbeddingClient;
  let lastInputs: string[];

  // A fake extractor mimicking transformers.js: returns one EMBEDDING_DIM vector per input,
  // exposing .tolist() like the real Tensor.
  const fakeExtractor = (inputs: string[], _opts: unknown) => {
    lastInputs = inputs;
    return Promise.resolve({
      tolist: () => inputs.map((_, i) => Array.from({ length: EMBEDDING_DIM }, () => i + 1)),
    });
  };

  beforeEach(() => {
    lastInputs = [];
    client = new LocalE5EmbeddingClient();
    // Bypass the dynamic import + model load: inject the fake pipeline directly.
    (client as any).extractor = Promise.resolve(fakeExtractor);
  });

  it('prefixes stored passages with "passage: "', async () => {
    await client.embedPassages(['净水器滤芯成本', '出水口感']);
    expect(lastInputs).toEqual(['passage: 净水器滤芯成本', 'passage: 出水口感']);
  });

  it('prefixes a search query with "query: "', async () => {
    await client.embedQuery('净水器用户在意什么');
    expect(lastInputs).toEqual(['query: 净水器用户在意什么']);
  });

  it('returns one EMBEDDING_DIM vector per passage', async () => {
    const out = await client.embedPassages(['a', 'b', 'c']);
    expect(out).toHaveLength(3);
    expect(out[0]).toHaveLength(EMBEDDING_DIM);
  });

  it('returns a single vector (not nested) from embedQuery', async () => {
    const vec = await client.embedQuery('x');
    expect(vec).toHaveLength(EMBEDDING_DIM);
    expect(typeof vec[0]).toBe('number');
  });

  it('returns an empty array without invoking the model for no passages', async () => {
    let called = false;
    (client as any).extractor = Promise.resolve((i: string[]) => { called = true; return { tolist: () => [] }; });
    expect(await client.embedPassages([])).toEqual([]);
    expect(called).toBe(false);
  });

  it('truncates an over-long model vector to EMBEDDING_DIM', async () => {
    (client as any).extractor = Promise.resolve((inputs: string[]) => ({
      tolist: () => inputs.map(() => Array.from({ length: EMBEDDING_DIM + 256 }, (_, i) => i)),
    }));
    const [vec] = await client.embedPassages(['x']);
    expect(vec).toHaveLength(EMBEDDING_DIM);
  });
});
