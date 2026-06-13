/*
  Warnings:

  - You are about to drop the column `dataset_id` on the `object_mappings` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "object_mappings" DROP CONSTRAINT "object_mappings_connector_id_fkey";

-- DropForeignKey
ALTER TABLE "object_mappings" DROP CONSTRAINT "object_mappings_dataset_id_fkey";

-- DropForeignKey
ALTER TABLE "sync_jobs" DROP CONSTRAINT "sync_jobs_connector_id_fkey";

-- DropIndex
DROP INDEX "document_chunks_embedding_idx";

-- AlterTable
ALTER TABLE "dataset_rows" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "datasets" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'clean',
ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "document_chunks" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "object_mappings" DROP COLUMN "dataset_id";

-- AlterTable
ALTER TABLE "research_documents" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "sync_jobs" ADD COLUMN     "mapping_id" UUID;

-- CreateTable
CREATE TABLE "pipelines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "connector_id" UUID NOT NULL,
    "output_object_type_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_steps" (
    "id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "input_dataset_id" UUID NOT NULL,
    "output_dataset_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "pg_boss_job_id" TEXT,
    "records_processed" INTEGER,
    "error" JSONB,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_actions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "payload" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "approved_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "execution_result" JSONB,
    "execution_error" TEXT,

    CONSTRAINT "pending_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pipelines_tenant_id_connector_id_output_object_type_id_key" ON "pipelines"("tenant_id", "connector_id", "output_object_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_steps_pipeline_id_order_key" ON "pipeline_steps"("pipeline_id", "order");

-- CreateIndex
CREATE INDEX "pending_actions_tenant_id_status_idx" ON "pending_actions"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "pending_actions_tenant_id_conversation_id_idx" ON "pending_actions"("tenant_id", "conversation_id");

-- AddForeignKey
ALTER TABLE "object_mappings" ADD CONSTRAINT "object_mappings_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "connectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "connectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_mapping_id_fkey" FOREIGN KEY ("mapping_id") REFERENCES "object_mappings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_output_object_type_id_fkey" FOREIGN KEY ("output_object_type_id") REFERENCES "object_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_steps" ADD CONSTRAINT "pipeline_steps_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_input_dataset_id_fkey" FOREIGN KEY ("input_dataset_id") REFERENCES "datasets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_output_dataset_id_fkey" FOREIGN KEY ("output_dataset_id") REFERENCES "datasets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
