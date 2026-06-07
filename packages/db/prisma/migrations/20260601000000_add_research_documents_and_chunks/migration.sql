-- Market-intelligence document-retrieval substrate (ADR-0042 §2, issue #98).
-- pgvector must exist before the vector column; Prisma cannot type a vector column,
-- so this migration is hand-authored (the embedding column is declared
-- Unsupported("vector(1024)") in schema.prisma).

CREATE EXTENSION IF NOT EXISTS vector;

-- ResearchDocument: the provenance object (the document is provenance, never a star type).
CREATE TABLE "research_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "agency" TEXT,
    "quarter" TEXT,
    "title" TEXT,
    "media_ref" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_documents_pkey" PRIMARY KEY ("id")
);

-- DocumentChunk: one embedded text chunk; the enrichment layer hung on the 品类 spine.
CREATE TABLE "document_chunks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "price_band" TEXT,
    "text" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    "embedding" vector(1024) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "research_documents_tenant_id_category_idx" ON "research_documents" ("tenant_id", "category");
CREATE INDEX "document_chunks_tenant_id_category_idx" ON "document_chunks" ("tenant_id", "category");

-- Approximate nearest-neighbour index for cosine distance (<=>). HNSW builds on an empty
-- table without a row-count-tuned lists parameter, unlike ivfflat.
CREATE INDEX "document_chunks_embedding_idx" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);

ALTER TABLE "research_documents" ADD CONSTRAINT "research_documents_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "research_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
