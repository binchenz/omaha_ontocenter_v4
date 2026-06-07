-- Dataset/Pipeline plane activation (ADR-0040)

CREATE TABLE "datasets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "connector_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "datasets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "dataset_rows" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "dataset_id" UUID NOT NULL,
    "row_index" INTEGER NOT NULL,
    "columns" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dataset_rows_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "object_mappings"
    DROP COLUMN IF EXISTS "table_name",
    ADD COLUMN IF NOT EXISTS "dataset_id" UUID,
    ALTER COLUMN "connector_id" DROP NOT NULL;

ALTER TABLE "sync_jobs"
    ADD COLUMN IF NOT EXISTS "dataset_id" UUID,
    ADD COLUMN IF NOT EXISTS "pg_boss_job_id" TEXT,
    ALTER COLUMN "connector_id" DROP NOT NULL;

CREATE UNIQUE INDEX "datasets_tenant_id_name_version_key" ON "datasets"("tenant_id", "name", "version");
CREATE INDEX "dataset_rows_tenant_id_dataset_id_idx" ON "dataset_rows"("tenant_id", "dataset_id");

DROP INDEX IF EXISTS "object_mappings_tenant_id_object_type_id_connector_id_key";
CREATE UNIQUE INDEX IF NOT EXISTS "object_mappings_tenant_id_object_type_id_key" ON "object_mappings"("tenant_id", "object_type_id");

ALTER TABLE "datasets" ADD CONSTRAINT "datasets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dataset_rows" ADD CONSTRAINT "dataset_rows_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dataset_rows" ADD CONSTRAINT "dataset_rows_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "object_mappings" ADD CONSTRAINT "object_mappings_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
