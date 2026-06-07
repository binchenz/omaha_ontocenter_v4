import { Injectable } from '@nestjs/common';
import { EmbeddingClient, EMBEDDING_DIM } from './embedding-client.interface';

/**
 * 火山引擎 ARK embedding client (doubao-embedding-large-text). OpenAI-compatible `/embeddings`
 * endpoint, so a plain `fetch` mirrors the DeepSeek LLM client — no SDK. The model is an MRL
 * model whose vectors are truncatable to {2048,1024,512,256}; we take the first EMBEDDING_DIM
 * (1024) and L2-normalize so cosine distance (pgvector `<=>`) is well-behaved. A search query
 * is prefixed with the model's retrieval instruction; stored passages are embedded raw.
 */
const ARK_EMBEDDINGS_URL = 'https://ark.cn-beijing.volces.com/api/v3/embeddings';
const MODEL = 'doubao-embedding-large-text-250515';
const QUERY_INSTRUCTION =
  'Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery: ';

@Injectable()
export class ArkEmbeddingClient implements EmbeddingClient {
  async embedPassages(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return this.embed(texts);
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vec] = await this.embed([`${QUERY_INSTRUCTION}${text}`]);
    return vec;
  }

  private async embed(inputs: string[]): Promise<number[][]> {
    const res = await fetch(ARK_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.ARK_API_KEY}`,
      },
      body: JSON.stringify({ model: MODEL, input: inputs, encoding_format: 'float' }),
    });
    if (!res.ok) {
      throw new Error(`ARK embeddings error ${res.status}: ${await res.text()}`);
    }
    const json = await res.json();
    // Preserve input order (the API returns an `index` per item).
    const data: Array<{ index: number; embedding: number[] }> = json.data;
    const ordered = [...data].sort((a, b) => a.index - b.index);
    return ordered.map((d) => normalize(d.embedding.slice(0, EMBEDDING_DIM)));
  }
}

/** L2-normalize a vector so cosine distance is comparable across vectors. */
function normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? vec : vec.map((x) => x / norm);
}
