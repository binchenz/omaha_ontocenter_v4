-- CreateTable
CREATE TABLE "object_type_indexes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "object_type_id" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "index_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "object_type_indexes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "object_type_indexes_index_name_key" ON "object_type_indexes"("index_name");

-- CreateIndex
CREATE INDEX "object_type_indexes_tenant_id_object_type_id_idx" ON "object_type_indexes"("tenant_id", "object_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "object_type_indexes_tenant_id_object_type_id_field_kind_key" ON "object_type_indexes"("tenant_id", "object_type_id", "field", "kind");

-- AddForeignKey
ALTER TABLE "object_type_indexes" ADD CONSTRAINT "object_type_indexes_object_type_id_fkey" FOREIGN KEY ("object_type_id") REFERENCES "object_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
