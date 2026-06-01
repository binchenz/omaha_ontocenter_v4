import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { EmbeddingClient, EMBEDDING_CLIENT } from './embedding/embedding-client.interface';

/** Where a retrieved chunk came from, so an answer can cite "据 <机构> <季度> 报告第 N 页". */
export interface ChunkProvenance {
  documentId: string;
  title: string | null;
  agency: string | null;
  quarter: string | null;
  page: number;
}

/** A chunk retrieved by semantic search, with its vector distance and provenance. */
export interface ScoredChunk {
  text: string;
  category: string;
  priceBand: string | null;
  distance: number;
  mediaRef: string;
  provenance: ChunkProvenance;
}

export interface SearchFilters {
  category?: string;
  priceBand?: string;
}

/**
 * Semantic retrieval over research-document chunks (ADR-0042 §2) — the read half of Asset B.
 * A NEW parallel read path: it does NOT go through the structured query compiler (which is
 * SQL/JSONB-only); it embeds the query, structurally pre-filters by 品类/价格段 (the spine),
 * then ranks by pgvector cosine distance. A plain singleton — it injects only Prisma and the
 * EmbeddingClient, deliberately NOT OntologyViewLoader, so it is not promoted to request scope.
 */
@Injectable()
export class SemanticSearchService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMBEDDING_CLIENT) private readonly embedding: EmbeddingClient,
  ) {}

  async search(
    tenantId: string,
    query: string,
    filters: SearchFilters,
    k: number,
  ): Promise<ScoredChunk[]> {
    const queryVec = await this.embedding.embedQuery(query);
    const vectorLiteral = `[${queryVec.join(',')}]`;

    const conditions = ['c.tenant_id = $1'];
    const params: unknown[] = [tenantId];
    if (filters.category) {
      params.push(filters.category);
      conditions.push(`c.category = $${params.length}`);
    }
    if (filters.priceBand) {
      params.push(filters.priceBand);
      conditions.push(`c.price_band = $${params.length}`);
    }
    params.push(vectorLiteral);
    const vecParam = `$${params.length}::vector`;
    params.push(k);
    const limitParam = `$${params.length}`;

    const sql = `
      SELECT c.text, c.category, c.price_band AS "priceBand", c.page,
             c.document_id AS "documentId", d.title, d.agency, d.quarter,
             d.media_ref AS "mediaRef",
             c.embedding <=> ${vecParam} AS distance
      FROM document_chunks c
      JOIN research_documents d ON d.id = c.document_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY c.embedding <=> ${vecParam}
      LIMIT ${limitParam}
    `;

    const rows = await this.prisma.$queryRawUnsafe<Array<{
      text: string; category: string; priceBand: string | null; page: number;
      documentId: string; title: string | null; agency: string | null;
      quarter: string | null; mediaRef: string; distance: number;
    }>>(sql, ...params);

    return rows.map((r) => ({
      text: r.text,
      category: r.category,
      priceBand: r.priceBand,
      distance: r.distance,
      mediaRef: r.mediaRef,
      provenance: {
        documentId: r.documentId,
        title: r.title,
        agency: r.agency,
        quarter: r.quarter,
        page: r.page,
      },
    }));
  }
}
