/**
 * ADR-0061 §1: how a numeric measure may be combined across rows/dimensions.
 * - `additive`     — can be SUM-ed across any dimension (零售额, 零售量).
 * - `non-additive` — meaningless to add across dimensions (份额/占比 — adding
 *                    shares across price bands is nonsense).
 * - `ratio`        — a quotient; a cross-row mean must be weighted
 *                    (Σnumerator ÷ Σdenominator), never a simple average (零售均价).
 */
export type Additivity = 'additive' | 'non-additive' | 'ratio';

/**
 * ADR-0061 §1: intrinsic aggregation semantics of one Property, lifted out of
 * skill prose so the aggregation layer can read it structurally.
 */
export interface PropertySemantics {
  kind: Additivity;
  /**
   * For a `ratio` field, the sibling numeric columns whose Σ ÷ Σ yields the
   * correct weighted mean. Present only when both live on the same row (so a
   * weighted rewrite is physically possible); absent for long-format measures
   * where numerator/denominator are sibling rows, not columns.
   */
  ratioOf?: { numerator: string; denominator: string };
}

export interface PropertyDefinition {
  name: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'json';
  required?: boolean;
  filterable?: boolean;
  sortable?: boolean;
  precision?: number;
  scale?: number;
  description?: string;
  unit?: string;
  /**
   * Controlled value set for a low-cardinality string field (e.g. status,
   * grade, relation type). A hard constraint: instance values outside this set
   * are rejected at import time. Only meaningful for `type: 'string'`.
   * Normalization of dirty source values is an upstream ETL concern — the
   * ontology only gates, it does not clean.
   */
  allowedValues?: string[];
  /**
   * ADR-0061 §1: aggregation semantics for a numeric measure. Read by the
   * AdditivityGuard before the aggregate SQL is built. Absent → treated as
   * `additive` (the safe default for a plain measure).
   */
  additivity?: Additivity;
  /** ADR-0061 §1: weight columns for a `ratio` measure (see PropertySemantics.ratioOf). */
  ratioOf?: { numerator: string; denominator: string };
}

export interface DerivedPropertyDefinition extends PropertyDefinition {
  expression: string;
  params?: Array<{ name: string; type: 'datetime' | 'decimal' | 'string' | 'int' | 'boolean' }>;
}

/**
 * ADR-0057: Dimension constraints for query-time validation.
 * Declared per ObjectType — required dims must be filtered, defaulted dims auto-inject.
 */
export interface DimensionConstraints {
  /** Properties that MUST appear in filters — omission returns structured error + available values */
  required: string[];
  /** Properties auto-injected with a default value when not filtered explicitly */
  defaults: Record<string, string>;
  /**
   * #178: alternative fields that satisfy a required dimension (keyed by the required field →
   * fields that count as equivalent). A coarser temporal scope satisfies a finer requirement:
   * market_metric requires `month`, but a `year` filter (ADR-0059, derived from month in lockstep)
   * is a valid period scope — so `{ month: ['year'] }` lets a groupBy[year] annual query through
   * instead of being rejected DIMENSION_REQUIRED:month (which forced month-exhaustion).
   */
  requiredEquivalents?: Record<string, string[]>;
  /**
   * ADR-0061 §3: dimensions that EXIST but are folded to a default unless the
   * query drills in (keyed by dimension → default value). Distinct from
   * `defaults`: a defaulted dimension is silently pinned (the Agent never learns
   * the dimension exists — dimension-default-blindspot); a collapsedDefault one
   * is surfaced through the schema so the Agent knows to groupBy/drill rather
   * than reverse-assert "no data". A dimension is typically in BOTH maps.
   */
  collapsedDefault?: Record<string, string>;
}

/**
 * ADR-0061 §2: ObjectType-level intrinsic semantics, lifted out of skill prose.
 * `universe` is the sampling frame of the star — two stars from different
 * universes must not impersonate each other (a TOP-sample roll-up ≠ official share).
 */
export interface ObjectTypeSemantics {
  universe?: 'whole-market' | 'top-sample' | string;
}

export interface CreateObjectTypeRequest {
  name: string;
  label: string;
  description?: string;
  properties: PropertyDefinition[];
  derivedProperties?: DerivedPropertyDefinition[];
  dimensions?: DimensionConstraints;
  semantics?: ObjectTypeSemantics;
}

export interface UpdateObjectTypeRequest {
  label?: string;
  description?: string;
  properties?: PropertyDefinition[];
  derivedProperties?: DerivedPropertyDefinition[];
  dimensions?: DimensionConstraints;
}

export interface ObjectTypeResponse {
  id: string;
  tenantId: string;
  name: string;
  label: string;
  description?: string;
  properties: PropertyDefinition[];
  derivedProperties: DerivedPropertyDefinition[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type Cardinality = 'one-to-one' | 'one-to-many' | 'many-to-many';

export interface CreateRelationshipRequest {
  sourceTypeId: string;
  targetTypeId: string;
  name: string;
  cardinality: Cardinality;
  description?: string;
}

export interface RelationshipResponse {
  id: string;
  tenantId: string;
  sourceTypeId: string;
  targetTypeId: string;
  name: string;
  cardinality: Cardinality;
  description?: string;
  createdAt: string;
}
