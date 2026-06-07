import { Inject, Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import { PrismaService } from '@omaha/db';
import { requireCategory } from '@omaha/shared-types';
import { DocumentTextExtractor } from './document-text-extractor';
import { Chunker } from './chunker';
import { EmbeddingClient, EMBEDDING_CLIENT } from './embedding/embedding-client.interface';
import { BlobStore, BLOB_STORE } from './blob-store';
import { toVectorLiteral } from './pgvector-util';

/** Document-level metadata confirmed once at ingest (ADR-0042 §5), not per chunk. */
export interface DocumentMetadata {
  category: string;
  agency?: string;
  quarter?: string;
  title?: string;
}

export interface IngestResult {
  documentId: string;
  chunks: number;
}

const CHUNK_SIZE = 600;
const CHUNK_OVERLAP = 100;

/**
 * Ingests a research PDF into retrievable chunks (ADR-0042 §2, §5): store the original to the
 * BlobStore (so a citation stays openable), extract per-page text, chunk it, embed the chunks,
 * and persist a ResearchDocument (provenance) plus its DocumentChunk rows. The vector column is
 * Unsupported() in Prisma, so chunk inserts go through raw SQL. Confirmation is at the document
 * level — the caller supplies the metadata once; chunking + embedding then run automatically.
 */
@Injectable()
export class DocumentIngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly extractor: DocumentTextExtractor,
    private readonly chunker: Chunker,
    @Inject(EMBEDDING_CLIENT) private readonly embedding: EmbeddingClient,
    @Inject(BLOB_STORE) private readonly blobStore: BlobStore,
  ) {}

  async ingest(tenantId: string, filePath: string, originalName: string, meta: DocumentMetadata): Promise<IngestResult> {
    const category = requireCategory(meta.category);

    // Read the PDF once; storing the original and extracting its text are independent.
    const bytes = await fs.readFile(filePath);
    const [mediaRef, pages] = await Promise.all([
      this.blobStore.store(bytes, originalName),
      this.extractor.extract(bytes),
    ]);
    const chunks = this.chunker.chunk(pages, { size: CHUNK_SIZE, overlap: CHUNK_OVERLAP });
    const embeddings = chunks.length > 0 ? await this.embedding.embedPassages(chunks.map((c) => c.text)) : [];

    // Document row + chunk rows are one atomic unit: a chunk-insert failure must roll the
    // document back, never leave an orphaned ResearchDocument with missing chunks. The blob
    // and embeddings are computed above, OUTSIDE the transaction — they are slow (disk/network)
    // and a transaction must stay short; an orphaned blob is benign (the BlobStore-lifecycle gap).
    const document = await this.prisma.$transaction(async (tx) => {
      const doc = await tx.researchDocument.create({
        data: {
          tenantId,
          category,
          agency: meta.agency,
          quarter: meta.quarter,
          title: meta.title ?? originalName,
          mediaRef,
        },
      });

      if (chunks.length > 0) {
        // Batch all chunks in one INSERT — N round-trips → 1. The embedding column is pgvector
        // (Unsupported in Prisma), so we hand-build the multi-row VALUES clause.
        const placeholders = chunks.map((_, i) => {
          const base = 3 + i * 4; // 3 fixed params: tenantId, docId, category; then 4 per chunk
          return `(gen_random_uuid(), $1::uuid, $2::uuid, $${base}, $${base + 1}, $${base + 2}, $${base + 3}::vector)`;
        });
        const chunkParams: unknown[] = [tenantId, doc.id];
        for (let i = 0; i < chunks.length; i++) {
          chunkParams.push(category, chunks[i].text, chunks[i].page, toVectorLiteral(embeddings[i]));
        }
        await tx.$executeRawUnsafe(
          `INSERT INTO "document_chunks" ("id","tenant_id","document_id","category","text","page","embedding") VALUES ${placeholders.join(',')}`,
          ...chunkParams,
        );
      }
      return doc;
    });

    return { documentId: document.id, chunks: chunks.length };
  }
}
