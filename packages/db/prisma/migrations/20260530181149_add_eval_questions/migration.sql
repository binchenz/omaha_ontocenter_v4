-- CreateTable
CREATE TABLE "eval_questions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "baseline_tool" TEXT NOT NULL,
    "baseline_args" JSONB NOT NULL DEFAULT '{}',
    "plan_summary" TEXT,
    "pass_history" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eval_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "eval_questions_tenant_id_idx" ON "eval_questions"("tenant_id");

-- AddForeignKey
ALTER TABLE "eval_questions" ADD CONSTRAINT "eval_questions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
