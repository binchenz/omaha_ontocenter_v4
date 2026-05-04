-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "compiled_sql_hash" TEXT,
ADD COLUMN     "effective_permission_filter" TEXT;
