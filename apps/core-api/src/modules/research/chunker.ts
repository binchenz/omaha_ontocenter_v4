/** A page of extracted text with its 1-based page anchor (for provenance). */
export interface PageText {
  page: number;
  text: string;
}

/**
 * A text chunk to embed, carrying the page it came from.
 * Structurally identical to PageText — aliased for semantic clarity at call sites.
 */
export type Chunk = PageText;

export interface ChunkOptions {
  /** Maximum characters per chunk. */
  size: number;
  /** Characters each chunk shares with the previous one (so context isn't split at a seam). */
  overlap: number;
}

/**
 * Splits page text into overlapping chunks for embedding (ADR-0042 §2, the minimal-B slice).
 * Pure function — no I/O. Each page is chunked independently so a chunk never spans a page
 * boundary, and every chunk keeps its source page for provenance. The simplest viable
 * strategy (fixed size + overlap); semantic/structure-aware chunking is deferred.
 */
export class Chunker {
  chunk(pages: PageText[], options: ChunkOptions): Chunk[] {
    const { size, overlap } = options;
    const stride = Math.max(1, size - overlap);
    const chunks: Chunk[] = [];

    for (const { page, text } of pages) {
      const trimmed = text.trim();
      if (!trimmed) continue; // skip empty / whitespace-only pages

      for (let start = 0; start < trimmed.length; start += stride) {
        chunks.push({ page, text: trimmed.slice(start, start + size) });
        // The chunk that reaches the end is the last one — don't emit a tiny trailing slice.
        if (start + size >= trimmed.length) break;
      }
    }

    return chunks;
  }
}
