/**
 * Text embedding for semantic retrieval (ADR-0042). Modelled on the LlmClient seam: an
 * interface + token so the provider (火山引擎 ARK doubao-embedding) can be swapped or faked.
 *
 * The interface deliberately distinguishes a *query* from a *passage* because the chosen
 * model (doubao-embedding-large-text) is asymmetric: a search query is embedded with an
 * instruction prefix, a stored passage is embedded raw. Collapsing the two would silently
 * degrade retrieval, so the asymmetry is part of the contract, not an impl detail.
 */
export interface EmbeddingClient {
  /** Embed stored passages (document chunks) — raw, no instruction prefix. */
  embedPassages(texts: string[]): Promise<number[][]>;
  /** Embed a search query — with the model's retrieval instruction prefix. */
  embedQuery(text: string): Promise<number[]>;
}

export const EMBEDDING_CLIENT = Symbol('EMBEDDING_CLIENT');

/** The vector dimension stored in pgvector (the MRL truncation chosen for doubao-embedding-large-text). */
export const EMBEDDING_DIM = 1024;
