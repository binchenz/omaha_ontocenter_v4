-- ADR-0061 §2: ObjectType-level intrinsic semantics (sampling `universe`), lifted out of skill prose.
-- Purely additive — defaults to '{}' so every existing ObjectType is unaffected; the three AVC stars
-- get their universe backfilled at ensureObjectType time via their DEF (no data migration needed).

-- AlterTable
ALTER TABLE "object_types" ADD COLUMN "semantics" JSONB NOT NULL DEFAULT '{}';
