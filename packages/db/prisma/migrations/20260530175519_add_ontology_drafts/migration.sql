-- CreateTable
CREATE TABLE "ontology_drafts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'editing',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ontology_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ontology_drafts_tenant_id_key" ON "ontology_drafts"("tenant_id");

-- AddForeignKey
ALTER TABLE "ontology_drafts" ADD CONSTRAINT "ontology_drafts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
