-- AlterTable
ALTER TABLE "object_instances" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "object_instances_tenant_id_object_type_deleted_at_idx" ON "object_instances"("tenant_id", "object_type", "deleted_at");
