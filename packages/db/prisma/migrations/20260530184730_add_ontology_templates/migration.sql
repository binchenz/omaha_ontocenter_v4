-- CreateTable
CREATE TABLE "ontology_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "question_bank" JSONB NOT NULL DEFAULT '[]',
    "owner_tenant_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ontology_templates_pkey" PRIMARY KEY ("id")
);
