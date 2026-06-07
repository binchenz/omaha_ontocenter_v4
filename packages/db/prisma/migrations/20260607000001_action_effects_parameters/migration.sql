-- AlterTable: add effects, parameters, precondition, description to action_definitions
ALTER TABLE "action_definitions" ADD COLUMN "description" TEXT NOT NULL DEFAULT '';
ALTER TABLE "action_definitions" ADD COLUMN "parameters" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "action_definitions" ADD COLUMN "precondition" TEXT;
ALTER TABLE "action_definitions" ADD COLUMN "effects" JSONB NOT NULL DEFAULT '[]';

-- Set default for permission (was required without default)
ALTER TABLE "action_definitions" ALTER COLUMN "permission" SET DEFAULT 'object.write';
