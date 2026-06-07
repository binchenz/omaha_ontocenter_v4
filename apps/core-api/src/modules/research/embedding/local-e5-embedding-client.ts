import { Injectable } from '@nestjs/common';
import { EmbeddingClient, EMBEDDING_DIM } from './embedding-client.interface';

/**
 * Local embedding client (ADR-0042) — the offline alternative to ArkEmbeddingClient behind the
 * same seam. Runs Xenova/multilingual-e5-large via transformers.js (ONNX, no network at query
 * time after the one-time model fetch). e5 is asymmetric: a stored passage is prefixed
 * "passage: ", a search query "query: " — mapping onto embedPassages/embedQuery. The model emits
 * 1024-d vectors (== EMBEDDING_DIM), mean-pooled and L2-normalized, so pgvector `<=>` is cosine.
 *
 * Chosen because the ARK account has no embedding model enabled; the model is loaded once
 * (lazily) and reused. huggingface.co is unreachable in this environment, so the loader points
 * at the hf-mirror.com mirror via HF_MODEL_HOST (default).
 */
const MODEL = 'Xenova/multilingual-e5-large';
const DEFAULT_HOST = 'https://hf-mirror.com';

@Injectable()
export class LocalE5EmbeddingClient implements EmbeddingClient {
  private extractor: Promise<any> | null = null;

  async embedPassages(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return this.embed(texts.map((t) => `passage: ${t}`));
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vec] = await this.embed([`query: ${text}`]);
    return vec;
  }

  /** Lazy-load the pipeline once; transformers.js is ESM, so import dynamically from CommonJS. */
  private async pipeline(): Promise<any> {
    if (!this.extractor) {
      this.extractor = (async () => {
        const { pipeline, env } = await import('@huggingface/transformers');
        env.remoteHost = process.env.HF_MODEL_HOST || DEFAULT_HOST;
        env.allowLocalModels = true; // reuse the on-disk cache across restarts
        return pipeline('feature-extraction', MODEL, { dtype: 'q8' });
      })();
    }
    return this.extractor;
  }

  private async embed(inputs: string[]): Promise<number[][]> {
    const extractor = await this.pipeline();
    const out = await extractor(inputs, { pooling: 'mean', normalize: true });
    // out.tolist() → number[][]; defensively truncate to EMBEDDING_DIM (e5-large is already 1024).
    return (out.tolist() as number[][]).map((v) => v.slice(0, EMBEDDING_DIM));
  }
}
