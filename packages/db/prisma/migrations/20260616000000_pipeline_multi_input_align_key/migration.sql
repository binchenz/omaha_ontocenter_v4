-- ADR-0060 #3: PipelineRun single inputDatasetId → multi-input set; Pipeline.alignKey; relax unique.
-- Order matters: create the new input table, BACKFILL existing single-input runs into it as
-- one-element sets, and only THEN drop the old scalar column — so no run loses its input.

-- AlterTable: add the optional batch-alignment key (null = "latest ready", backward compatible).
ALTER TABLE "pipelines" ADD COLUMN "align_key" TEXT;

-- DropIndex: a Pipeline may now declare multiple input sources, so one connector no longer keys it.
DROP INDEX "pipelines_tenant_id_connector_id_output_object_type_id_key";

-- CreateTable: the multi-input join (one row per input Dataset version a run consumes).
CREATE TABLE "pipeline_run_inputs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pipeline_run_id" UUID NOT NULL,
    "dataset_id" UUID NOT NULL,
    "input_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_run_inputs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pipeline_run_inputs_tenant_id_pipeline_run_id_idx" ON "pipeline_run_inputs"("tenant_id", "pipeline_run_id");

CREATE UNIQUE INDEX "pipeline_run_inputs_pipeline_run_id_dataset_id_key" ON "pipeline_run_inputs"("pipeline_run_id", "dataset_id");

ALTER TABLE "pipeline_run_inputs" ADD CONSTRAINT "pipeline_run_inputs_pipeline_run_id_fkey" FOREIGN KEY ("pipeline_run_id") REFERENCES "pipeline_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pipeline_run_inputs" ADD CONSTRAINT "pipeline_run_inputs_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: every existing PipelineRun becomes a one-element input set, preserving semantics.
INSERT INTO "pipeline_run_inputs" ("id", "tenant_id", "pipeline_run_id", "dataset_id")
SELECT gen_random_uuid(), "tenant_id", "id", "input_dataset_id"
FROM "pipeline_runs"
WHERE "input_dataset_id" IS NOT NULL;

-- Now safe to drop the old scalar column + its FK.
ALTER TABLE "pipeline_runs" DROP CONSTRAINT "pipeline_runs_input_dataset_id_fkey";
ALTER TABLE "pipeline_runs" DROP COLUMN "input_dataset_id";
