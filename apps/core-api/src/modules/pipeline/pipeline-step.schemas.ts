import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/**
 * Per-type config schemas for PipelineStep (ADR-0053).
 *
 * `type` is an enum; each value pins the shape of `config`. Validation runs at
 * configure time so a malformed step is rejected before it ever reaches the
 * PipelineRunWorker. Schemas are strict (`.strict()`) so stray keys — e.g. a
 * composite `{ and: [...] }` filter — are rejected rather than silently dropped.
 */

const FILTER_OPERATORS = ['eq', 'gt', 'lt', 'gte', 'lte', 'contains', 'in'] as const;

// Single-condition only. Composite (AND/OR) conditions are expressed as multiple
// filter steps (Q7a), so a `{ and: [...] }` shape fails `.strict()`.
const filterSchema = z
  .object({
    field: z.string(),
    operator: z.enum(FILTER_OPERATORS),
    value: z.unknown(),
  })
  .strict();

// Rename only — no column pruning (Q7b).
const renameSchema = z
  .object({
    mappings: z.record(z.string(), z.string()),
  })
  .strict();

const COMPUTE_FUNCTIONS = ['normalize_brand', 'price_band'] as const;

// Config comes either inline (`params`) or by reference (`configRef`+`configVersion`) (Q7c).
const computeSchema = z
  .object({
    function: z.enum(COMPUTE_FUNCTIONS),
    inputField: z.string(),
    outputField: z.string(),
    configRef: z.string().optional(),
    configVersion: z.number().int().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const PIPELINE_STEP_SCHEMAS = {
  filter: filterSchema,
  rename: renameSchema,
  compute: computeSchema,
} as const;

export type PipelineStepType = keyof typeof PIPELINE_STEP_SCHEMAS;

/**
 * Validate a PipelineStep `config` against its `type` schema.
 * Throws BadRequestException for an unknown type or an invalid config so the
 * failure surfaces a usable message to whoever is persisting the step.
 */
export function validatePipelineStep(type: string, config: unknown): Record<string, unknown> {
  const schema = PIPELINE_STEP_SCHEMAS[type as PipelineStepType];
  if (!schema) throw new BadRequestException(`Unknown PipelineStep type: ${type}`);
  const parsed = schema.safeParse(config);
  if (!parsed.success) {
    throw new BadRequestException(
      `Invalid ${type} step config: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return parsed.data as Record<string, unknown>;
}
