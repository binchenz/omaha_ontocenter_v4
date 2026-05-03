-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "object_types" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "properties" JSONB NOT NULL DEFAULT '[]',
    "derived_properties" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "object_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "object_relationships" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "source_type_id" UUID NOT NULL,
    "target_type_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "cardinality" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "object_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connectors" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'inactive',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "object_mappings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "object_type_id" UUID NOT NULL,
    "connector_id" UUID NOT NULL,
    "table_name" TEXT NOT NULL,
    "property_mappings" JSONB NOT NULL DEFAULT '{}',
    "relationship_mappings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "object_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "object_instances" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "object_type" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "label" TEXT,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "relationships" JSONB NOT NULL DEFAULT '{}',
    "source_ref" JSONB,
    "search_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "object_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "connector_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "records_processed" INTEGER NOT NULL DEFAULT 0,
    "records_failed" INTEGER NOT NULL DEFAULT 0,
    "error_log" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_turns" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT,
    "tool_calls" JSONB,
    "tool_results" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_turns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_definitions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger_conditions" JSONB,
    "content" TEXT NOT NULL,
    "is_always_on" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "actor_type" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "object_type" TEXT,
    "query_plan" JSONB,
    "result_count" INTEGER,
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_definitions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "object_type" TEXT NOT NULL,
    "input_schema" JSONB NOT NULL DEFAULT '{}',
    "preconditions" JSONB NOT NULL DEFAULT '[]',
    "permission" TEXT NOT NULL,
    "requires_confirmation" BOOLEAN NOT NULL DEFAULT true,
    "risk_level" TEXT NOT NULL DEFAULT 'low',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_previews" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "action_def_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "target_ids" UUID[],
    "input_params" JSONB NOT NULL DEFAULT '{}',
    "preview_result" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_previews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "preview_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "error" JSONB,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_name_key" ON "roles"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "object_types_tenant_id_name_key" ON "object_types"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "object_relationships_tenant_id_source_type_id_name_key" ON "object_relationships"("tenant_id", "source_type_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "connectors_tenant_id_name_key" ON "connectors"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "object_mappings_tenant_id_object_type_id_connector_id_key" ON "object_mappings"("tenant_id", "object_type_id", "connector_id");

-- CreateIndex
CREATE INDEX "object_instances_tenant_id_object_type_idx" ON "object_instances"("tenant_id", "object_type");

-- CreateIndex
CREATE UNIQUE INDEX "object_instances_tenant_id_object_type_external_id_key" ON "object_instances"("tenant_id", "object_type", "external_id");

-- CreateIndex
CREATE INDEX "conversation_turns_conversation_id_created_at_idx" ON "conversation_turns"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "action_definitions_tenant_id_name_key" ON "action_definitions"("tenant_id", "name");

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "object_types" ADD CONSTRAINT "object_types_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "object_relationships" ADD CONSTRAINT "object_relationships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "object_relationships" ADD CONSTRAINT "object_relationships_source_type_id_fkey" FOREIGN KEY ("source_type_id") REFERENCES "object_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "object_relationships" ADD CONSTRAINT "object_relationships_target_type_id_fkey" FOREIGN KEY ("target_type_id") REFERENCES "object_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "object_mappings" ADD CONSTRAINT "object_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "object_mappings" ADD CONSTRAINT "object_mappings_object_type_id_fkey" FOREIGN KEY ("object_type_id") REFERENCES "object_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "object_mappings" ADD CONSTRAINT "object_mappings_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "object_instances" ADD CONSTRAINT "object_instances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_definitions" ADD CONSTRAINT "skill_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_definitions" ADD CONSTRAINT "action_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_previews" ADD CONSTRAINT "action_previews_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_previews" ADD CONSTRAINT "action_previews_action_def_id_fkey" FOREIGN KEY ("action_def_id") REFERENCES "action_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_previews" ADD CONSTRAINT "action_previews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_runs" ADD CONSTRAINT "action_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_runs" ADD CONSTRAINT "action_runs_preview_id_fkey" FOREIGN KEY ("preview_id") REFERENCES "action_previews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_runs" ADD CONSTRAINT "action_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
