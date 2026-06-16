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

const COMPUTE_FUNCTIONS = ['normalize_brand', 'price_band', 'concat'] as const;

// Config comes either inline (`params`) or by reference (`configRef`+`configVersion`) (Q7c).
// `concat` (#177) builds outputField from `fields` + `separator` and carries no inputField, so
// inputField is optional; `fields`/`separator` are concat-only. The engine reads what it needs
// per function — the schema only guarantees the shared shape and that stray keys are rejected.
const computeSchema = z
  .object({
    function: z.enum(COMPUTE_FUNCTIONS),
    inputField: z.string().optional(),
    outputField: z.string(),
    configRef: z.string().optional(),
    configVersion: z.number().int().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    // concat-only: source fields joined by separator into outputField.
    fields: z.array(z.string()).optional(),
    separator: z.string().optional(),
  })
  .strict();

// --- ADR-0060 #2 single-input operators ---

// explode_json shreds a nested JSON field (device-log payloads). array → one row per element;
// object → spread the field's keys to top level. Enum-constrained mode (no raw SQL).
const explodeJsonSchema = z
  .object({
    field: z.string(),
    mode: z.enum(['array', 'object']),
  })
  .strict();

// dedup collapses duplicate rows by a declared key set, keeping the first occurrence.
const dedupSchema = z
  .object({
    keys: z.array(z.string()).min(1),
  })
  .strict();

const AGGREGATE_OPS = ['sum', 'count', 'avg', 'min', 'max'] as const;

// aggregate: GROUP BY + named metrics. `count` needs no field; the numeric ops do — enforced in
// the engine (a field-less sum is a configure-time-valid but engine-rejected error message).
const aggregateMetricSchema = z
  .object({
    op: z.enum(AGGREGATE_OPS),
    field: z.string().optional(),
    as: z.string(),
  })
  .strict();

const aggregateSchema = z
  .object({
    groupBy: z.array(z.string()).min(1),
    metrics: z.array(aggregateMetricSchema).min(1),
  })
  .strict();

// --- ADR-0060 #4 multi-input join (fact × fact only) ---

const JOIN_TYPES = ['inner', 'left'] as const;

// join merges two named inputs on a declared key set. left/right reference run() input names.
// fact × dimension is NOT a join — it stays a query-time Field Path (ADR-0044).
const joinSchema = z
  .object({
    left: z.string(),
    right: z.string(),
    type: z.enum(JOIN_TYPES),
    on: z
      .array(z.object({ leftField: z.string(), rightField: z.string() }).strict())
      .min(1),
  })
  .strict();

export const PIPELINE_STEP_SCHEMAS = {
  filter: filterSchema,
  rename: renameSchema,
  compute: computeSchema,
  explode_json: explodeJsonSchema,
  dedup: dedupSchema,
  aggregate: aggregateSchema,
  join: joinSchema,
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
