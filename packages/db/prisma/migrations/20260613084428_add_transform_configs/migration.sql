-- CreateTable
CREATE TABLE "transform_configs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transform_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transform_configs_tenant_id_name_idx" ON "transform_configs"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "transform_configs_tenant_id_name_version_key" ON "transform_configs"("tenant_id", "name", "version");

-- AddForeignKey
ALTER TABLE "transform_configs" ADD CONSTRAINT "transform_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transform_configs" ADD CONSTRAINT "transform_configs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
