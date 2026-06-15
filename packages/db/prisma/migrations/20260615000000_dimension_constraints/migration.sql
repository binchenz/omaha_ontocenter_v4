-- ADR-0057: Ontology Dimension Constraints
-- Add dimensions JSONB column to object_types for query-time validation

ALTER TABLE "object_types" ADD COLUMN "dimensions" JSONB NOT NULL DEFAULT '{}';

-- Backfill AVC three stars
UPDATE "object_types" SET "dimensions" = '{"required":["category","month"],"defaults":{}}'
  WHERE "name" = 'market_metric';

UPDATE "object_types" SET "dimensions" = '{"required":["category","period"],"defaults":{"priceBand":"整体"}}'
  WHERE "name" = 'brand_share';

UPDATE "object_types" SET "dimensions" = '{"required":["category","month"],"defaults":{}}'
  WHERE "name" = 'model_metric';
