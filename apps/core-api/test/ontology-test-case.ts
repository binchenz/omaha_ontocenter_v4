/**
 * OntologyTestCase — unified harness for ontology evolution e2e tests
 *
 * Reuses the delivery-report verdict pattern (anchor probe, ground truth, pure verdict fn)
 * for testing schema changes and data queries in ephemeral tenants. Supports both:
 *   - Schema evolution (add derived field, dimension constraint, relationship, etc.)
 *   - Data query correctness (agent queries against seeded data)
 *
 * Design principles:
 *   1. Ephemeral tenant per test case (no cross-contamination)
 *   2. Pure verdict functions (no LLM judges, auditable logic)
 *   3. Independent ground truth (raw SQL, bypasses DSL/query modules)
 *   4. Extensible scenario catalog (10+ scenarios, easy to add)
 *
 * Architecture (4 layers):
 *   - Setup: provision ephemeral tenant + seed ontology + ingest test data
 *   - Probe: runtime discovery of data shape (like delivery-report anchors)
 *   - Execute: apply schema change OR run agent query
 *   - Verify: ground truth extraction + pure verdict function
 */

import type { PrismaClient } from '@omaha/db';
import type { INestApplication } from '@nestjs/common';

// ──────────────────────────────────────────────────────────────────────────────
// Core Types
// ──────────────────────────────────────────────────────────────────────────────

/**
 * A single ontology test case. The track determines the verification strategy:
 *   - 'schema': verify ObjectType/Field structure in DB + matview columns
 *   - 'query': verify agent's SQL output + tool_result correctness
 *   - 'agent': verify agent's final answer (like delivery-report fact/behavior tracks)
 */
export interface OntologyTestCase {
  /** Unique identifier (e.g. "DERIVED-001", "DIM-002", "REL-003") */
  id: string;

  /** Human-readable title */
  title: string;

  /** Which aspect of the ontology is being tested */
  category: TestCategory;

  /** Verification strategy */
  track: 'schema' | 'query' | 'agent';

  /**
   * Setup phase: provision ephemeral tenant + seed ontology/data.
   * Returns the tenant ID and any runtime anchors (discovered data shape).
   */
  setup: (ctx: SetupContext) => Promise<SetupResult>;

  /**
   * Execute phase: apply the schema change OR trigger the agent query.
   * For schema tests: POST /ontology/types, refresh matview, etc.
   * For query tests: POST /agent/chat with the test question.
   */
  execute: (ctx: ExecuteContext) => Promise<ExecuteResult>;

  /**
   * Verify phase: extract ground truth + run pure verdict functions.
   * Returns a structured verdict (pass/fail + detail string).
   */
  verify: (ctx: VerifyContext) => Promise<TestVerdict>;
}

export type TestCategory =
  | 'derived-field'         // ADR-0059: add derived field, backfill, verify Agent can see it
  | 'dimension-constraint'  // ADR-0057: enforce required/default dims, verify query planner
  | 'relationship'          // Add ObjectRelation, verify join queries work
  | 'field-visibility'      // Field-level permissions (ADR-0035/36), verify filtering
  | 'semantics'             // ADR-0061: additivity/aggregation rules, verify guard fires
  | 'pipeline'              // ADR-0060: multi-input alignment, verify transform correctness
  | 'metric-catalogue'      // ADR-0064: resolve metric, verify bound aggregate query
  | 'action'                // ADR-0048: declarative action, verify effect application
  | 'computed-property'     // ADR-0048: Agent writes DSL, verify computed field eval
  | 'cross-tenant'          // Multi-tenant isolation (scenario-multi-tenant pattern)
  ;

// ──────────────────────────────────────────────────────────────────────────────
// Context Types (inputs to each phase)
// ──────────────────────────────────────────────────────────────────────────────

export interface SetupContext {
  app: INestApplication;
  prisma: PrismaClient;
  /** Helper to provision a fresh tenant with admin user */
  provisionTenant: (slug: string, name: string) => Promise<{ tenantId: string; token: string }>;
}

export interface SetupResult {
  tenantId: string;
  token: string;
  /** Runtime-discovered data anchors (like delivery-report probeAnchors) */
  anchors: Record<string, unknown>;
}

export interface ExecuteContext extends SetupResult {
  app: INestApplication;
  prisma: PrismaClient;
}

export interface ExecuteResult {
  /** For schema track: the created/modified ObjectType ID */
  objectTypeId?: string;
  /** For query/agent track: SSE events from /agent/chat */
  events?: SseEvent[];
  /** Any additional execution metadata */
  metadata?: Record<string, unknown>;
}

export interface VerifyContext extends ExecuteResult {
  tenantId: string;
  prisma: PrismaClient;
  /** Independent ground truth oracle (raw SQL, bypasses DSL) */
  groundTruth: OntologyGroundTruth;
}

export interface SseEvent {
  type: string;
  [key: string]: unknown;
}

// ──────────────────────────────────────────────────────────────────────────────
// Verdict Types (outputs from verify phase)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Test verdict — same structure as delivery-report Verdict.
 * Pure function output: given inputs, did the test pass?
 */
export interface TestVerdict {
  pass: boolean;
  /** Human-readable explanation (surfaced in test report) */
  detail: string;
  /** For multi-layer tests: individual sub-verdicts */
  layers?: Record<string, Verdict>;
}

export interface Verdict {
  pass: boolean;
  detail: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Ground Truth Oracle (independent SQL layer)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * OntologyGroundTruth — the schema-testing equivalent of delivery-report GroundTruth.
 * Hits Prisma raw SQL to verify ontology state WITHOUT going through the DSL/query modules.
 * All queries cast tenant_id as uuid (same trap as delivery-report learned).
 */
export class OntologyGroundTruth {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Does an ObjectType exist with the given name?
   */
  async objectTypeExists(tenantId: string, name: string): Promise<boolean> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*)::int AS n FROM object_types WHERE tenant_id = $1::uuid AND name = $2 AND deleted_at IS NULL`,
      tenantId, name,
    );
    return (rows[0]?.n ?? 0) > 0;
  }

  /**
   * Get the field schema for an ObjectType (name, type, unit, etc.)
   */
  async getFieldSchema(tenantId: string, objectType: string, fieldName: string): Promise<FieldSchema | null> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ properties: any }>>(
      `SELECT properties FROM object_types WHERE tenant_id = $1::uuid AND name = $2 AND deleted_at IS NULL`,
      tenantId, objectType,
    );
    if (!rows[0]) return null;
    const props = rows[0].properties as Array<any>;
    const field = props.find((p: any) => p.name === fieldName);
    return field ? { name: field.name, type: field.type, unit: field.unit, formula: field.formula } : null;
  }

  /**
   * Does the materialized view for an ObjectType have the given column?
   */
  async matviewHasColumn(tenantId: string, objectType: string, columnName: string): Promise<boolean> {
    const matviewName = `mv_${objectType}`;
    const rows = await this.prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*)::int AS n FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      matviewName, columnName,
    );
    return (rows[0]?.n ?? 0) > 0;
  }

  /**
   * Query object instances directly (bypasses DSL) — returns raw JSONB properties.
   */
  async queryInstances(tenantId: string, objectType: string, limit = 100): Promise<Array<Record<string, any>>> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ properties: any }>>(
      `SELECT properties FROM object_instances
       WHERE tenant_id = $1::uuid AND object_type = $2 AND deleted_at IS NULL LIMIT $3`,
      tenantId, objectType, limit,
    );
    return rows.map(r => r.properties as Record<string, any>);
  }

  /**
   * Does a specific instance have a non-null value for a field?
   */
  async instanceHasField(tenantId: string, objectType: string, instanceId: string, fieldName: string): Promise<boolean> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ v: any }>>(
      `SELECT properties->>'${fieldName}' AS v FROM object_instances
       WHERE tenant_id = $1::uuid AND object_type = $2 AND id = $3::uuid AND deleted_at IS NULL`,
      tenantId, objectType, instanceId,
    );
    return rows[0]?.v !== null && rows[0]?.v !== undefined;
  }

  /**
   * Get dimension constraint metadata (required/defaultValue) from ObjectType properties.
   */
  async getDimensionConstraint(tenantId: string, objectType: string, dimName: string): Promise<DimensionConstraint | null> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ properties: any }>>(
      `SELECT properties FROM object_types WHERE tenant_id = $1::uuid AND name = $2 AND deleted_at IS NULL`,
      tenantId, objectType,
    );
    if (!rows[0]) return null;
    const props = rows[0].properties as Array<any>;
    const dim = props.find((p: any) => p.name === dimName);
    if (!dim) return null;
    return {
      required: dim.required ?? false,
      defaultValue: dim.defaultValue,
    };
  }

  /**
   * Verify an ObjectRelation exists between two types.
   */
  async relationExists(tenantId: string, fromType: string, toType: string, name: string): Promise<boolean> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*)::int AS n FROM object_relations
       WHERE tenant_id = $1::uuid AND from_type = $2 AND to_type = $3 AND name = $4 AND deleted_at IS NULL`,
      tenantId, fromType, toType, name,
    );
    return (rows[0]?.n ?? 0) > 0;
  }
}

interface FieldSchema {
  name: string;
  type: string;
  unit?: string;
  formula?: string;
}

interface DimensionConstraint {
  required: boolean;
  defaultValue?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Verdict Helpers (pure functions, reusable across scenarios)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Schema layer verdict: does the ObjectType have the expected field, and does the
 * matview have the corresponding column? (ADR-0059 lesson: both must be true.)
 */
export async function verifyFieldExists(input: {
  gt: OntologyGroundTruth;
  tenantId: string;
  objectType: string;
  fieldName: string;
  expectedType: string;
}): Promise<Verdict> {
  const schema = await input.gt.getFieldSchema(input.tenantId, input.objectType, input.fieldName);
  if (!schema) {
    return { pass: false, detail: `ObjectType.properties 中未找到字段 ${input.fieldName}` };
  }
  if (schema.type !== input.expectedType) {
    return { pass: false, detail: `字段类型不符：期望 ${input.expectedType}，实际 ${schema.type}` };
  }
  const hasColumn = await input.gt.matviewHasColumn(input.tenantId, input.objectType, input.fieldName);
  if (!hasColumn) {
    return { pass: false, detail: `matview 中未找到列 ${input.fieldName}（schema 正确但 view 未同步）` };
  }
  return { pass: true, detail: `字段 ${input.fieldName}:${input.expectedType} 存在于 schema + matview` };
}

/**
 * Data layer verdict: do all instances have a non-null value for the backfilled field?
 */
export async function verifyFieldBackfilled(input: {
  gt: OntologyGroundTruth;
  tenantId: string;
  objectType: string;
  fieldName: string;
}): Promise<Verdict> {
  const instances = await input.gt.queryInstances(input.tenantId, input.objectType);
  const missing = instances.filter(inst => inst[input.fieldName] === null || inst[input.fieldName] === undefined);
  if (missing.length > 0) {
    return { pass: false, detail: `${missing.length}/${instances.length} 实例的 ${input.fieldName} 字段为空（backfill 未完成）` };
  }
  return { pass: true, detail: `${instances.length} 个实例的 ${input.fieldName} 字段均已填充` };
}

/**
 * Dimension constraint verdict: does the constraint match expectations?
 */
export async function verifyDimensionConstraint(input: {
  gt: OntologyGroundTruth;
  tenantId: string;
  objectType: string;
  dimName: string;
  expectedRequired: boolean;
  expectedDefault?: string;
}): Promise<Verdict> {
  const constraint = await input.gt.getDimensionConstraint(input.tenantId, input.objectType, input.dimName);
  if (!constraint) {
    return { pass: false, detail: `未找到维度 ${input.dimName} 的约束` };
  }
  if (constraint.required !== input.expectedRequired) {
    return { pass: false, detail: `required 不符：期望 ${input.expectedRequired}，实际 ${constraint.required}` };
  }
  if (input.expectedDefault && constraint.defaultValue !== input.expectedDefault) {
    return { pass: false, detail: `defaultValue 不符：期望 ${input.expectedDefault}，实际 ${constraint.defaultValue}` };
  }
  return { pass: true, detail: `维度约束正确：required=${constraint.required}, default=${constraint.defaultValue ?? 'null'}` };
}
