import { Inject, Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import { PrismaService } from '@omaha/db';
import { normalizeCategory } from '@omaha/shared-types';
import { DocumentTextExtractor } from './document-text-extractor';
import { Chunker } from './chunker';
import { EmbeddingClient, EMBEDDING_CLIENT } from './embedding/embedding-client.interface';
import { BlobStore, BLOB_STORE } from './blob-store';

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
    const category = normalizeCategory(meta.category);
    if (!category) {
      throw new Error(`Unknown 品类 "${meta.category}" — not in the category vocabulary.`);
    }

    const mediaRef = await this.blobStore.store(await fs.readFile(filePath), originalName);
    const pages = await this.extractor.extract(filePath);
    const chunks = this.chunker.chunk(pages, { size: CHUNK_SIZE, overlap: CHUNK_OVERLAP });
    const embeddings = chunks.length > 0 ? await this.embedding.embedPassages(chunks.map((c) => c.text)) : [];

    const document = await this.prisma.researchDocument.create({
      data: {
        tenantId,
        category,
        agency: meta.agency,
        quarter: meta.quarter,
        title: meta.title ?? originalName,
        mediaRef,
      },
    });

    for (let i = 0; i < chunks.length; i++) {
      // Raw SQL: the embedding column is pgvector, unsupported by the Prisma client.
      const vectorLiteral = `[${embeddings[i].join(',')}]`;
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO "document_chunks"
           ("id", "tenant_id", "document_id", "category", "text", "page", "embedding")
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, $5, $6::vector)`,
        tenantId,
        document.id,
        category,
        chunks[i].text,
        chunks[i].page,
        vectorLiteral,
      );
    }

    return { documentId: document.id, chunks: chunks.length };
  }
}
