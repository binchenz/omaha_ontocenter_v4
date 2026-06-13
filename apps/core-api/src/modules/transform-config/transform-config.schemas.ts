import { z } from 'zod';

/**
 * Per-type config schemas for TransformConfig (ADR-0054).
 * `type` is an enum; each value pins the shape of `config`. Validation runs at
 * create time so a malformed dictionary never reaches the PipelineRunWorker.
 */

const brandMappingSchema = z.object({
  mappings: z.record(z.string(), z.string()),
  caseSensitive: z.boolean().optional(),
});

const priceBandsSchema = z.object({
  bands: z
    .array(
      z.object({
        max: z.number().optional(), // omitted on the open-ended top band
        label: z.string(),
      }),
    )
    .min(1),
});

export const TRANSFORM_CONFIG_SCHEMAS = {
  brand_mapping: brandMappingSchema,
  price_bands: priceBandsSchema,
} as const;

export type TransformConfigType = keyof typeof TRANSFORM_CONFIG_SCHEMAS;
