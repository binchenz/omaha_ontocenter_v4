-- ADR-0060 follow-up #186: Pipeline-level declared inputs + per-Dataset align key value.
-- Purely additive — `pipeline_inputs` is empty for existing Pipelines (they keep the implicit
-- single-input-by-connector behavior), and `align_key_value` defaults NULL (latest-ready). No
-- backfill needed; single-input AVC is unaffected.

-- AlterTable
ALTER TABLE "datasets" ADD COLUMN     "align_key_value" TEXT;

-- CreateTable
CREATE TABLE "pipeline_inputs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "input_name" TEXT NOT NULL,
    "connector_id" UUID NOT NULL,
    "align_key_field" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_inputs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pipeline_inputs_tenant_id_connector_id_idx" ON "pipeline_inputs"("tenant_id", "connector_id");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_inputs_pipeline_id_input_name_key" ON "pipeline_inputs"("pipeline_id", "input_name");

-- AddForeignKey
ALTER TABLE "pipeline_inputs" ADD CONSTRAINT "pipeline_inputs_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_inputs" ADD CONSTRAINT "pipeline_inputs_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

