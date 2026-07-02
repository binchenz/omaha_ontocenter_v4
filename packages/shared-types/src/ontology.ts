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
 *
 * Phase 1 #214: aggregationWhitelist for disjoint entity sum (brand_share.value).
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
  /**
   * Phase 1 #214: Whitelist exceptions for otherwise-forbidden aggregations.
   * A non-additive field (like brand_share.value, which is a share/占比) normally
   * rejects SUM across dimensions. But when the filter pins disjoint entities
   * (e.g. `brand IN [小米, 米家]` where the two brands have no overlapping rows),
   * summing their shares IS mathematically valid (each brand's share is independent).
   * Setting `disjointEntities: true` tells the planner to check the DB for overlap
   * before rejecting; if the filtered entities are truly disjoint, SUM is allowed.
   */
  aggregationWhitelist?: {
    disjointEntities?: boolean;
  };
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
  // Slice C: derived fields inherit additivity semantics from PropertyDefinition
  // (already includes additivity?: Additivity and ratioOf?: {...})
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
 * ADR-0064 §1: the star's temporal sampling frame, declared once in the ontology.
 * Structurally isomorphic to `universe` (the sampling frame): `universe` says
 * *whose* rows a star carries, `timeAxis` says *when*. It pins the DESIGN INTENT —
 * which field is the series axis, its grain, how to read a value, and whether the
 * series is meant to be continuous. The ACTUAL periods that exist (which change on
 * every ingest) are never stored here — those are always probed live (ADR-0064 §3,
 * the ADR-0043 §2 boundary). Baking coverage in would go stale and re-create BUG-2.
 */
export interface TimeAxis {
  /** Which column is the series axis (e.g. 'month' for market_metric, 'period' for brand_share). */
  field: string;
  /** The intended cadence of one step on the axis. */
  grain: 'month' | 'quarter' | 'year' | 'snapshot';
  /** How to read a single value, pinned so the LLM never re-interprets it (e.g. 'YY.MM（26.04=2026年4月）'). */
  format?: string;
  /**
   * The EXPECTED shape (design intent, NOT actual coverage): `dense` = a continuous
   * series the Agent should draw as a line and probe for real periods; `sparse` =
   * occasional snapshots, not a continuous trend.
   */
  density: 'dense' | 'sparse';
}

/**
 * ADR-0061 §2: ObjectType-level intrinsic semantics, lifted out of skill prose.
 * `universe` is the sampling frame of the star — two stars from different
 * universes must not impersonate each other (a TOP-sample roll-up ≠ official share).
 */
export interface ObjectTypeSemantics {
  universe?: 'whole-market' | 'top-sample' | string;
  /** ADR-0064 §1: the star's temporal sampling frame, beside `universe`. */
  timeAxis?: TimeAxis;
}

/**
 * ADR-0064 §2: the self-describing result envelope. `query_objects` /
 * `aggregate_objects` stop handing the LLM bare floats; every measure value comes
 * back wrapped so the semantics travel WITH the data (context-and-data co-located),
 * and — crucially — so the LLM physically never holds the raw float it was
 * mis-transcribing (BUG-1 structurally disappears).
 *
 * Prompt contract (one rule): a reported monetary/measure value MUST be quoted
 * verbatim from `display`. The LLM may read `raw` for its OWN reasoning (computing
 * a ratio, comparing magnitudes), but the figure it writes back to the user is
 * always `display`. It must never re-derive, convert, or re-typeset a number.
 */
export interface MeasureCell {
  /** Server-formatted, business-ready string — the ONLY field the prompt may quote (e.g. "3.90 亿元（39,012.84 万元）"). */
  display: string;
  /** The underlying numeric value, preserved for the LLM's own reasoning (never reported verbatim). */
  raw: number;
  /** The unit `raw` is expressed in (e.g. '万元', '万台', '元', '%'). Empty for a unitless count. */
  unit: string;
  /** The metric this cell measures, when known (e.g. '零售额', '份额'). Carries the alias otherwise. */
  metric: string;
  /** ADR-0061 §1: how this measure may be combined — so the caliber rides on the data, not only the prompt. */
  additivity: Additivity;
  /** ADR-0061 §2: the sampling universe of the source star, when declared (whole-market vs top-sample). */
  universe?: string;
  /** ADR-0064 §1: the source star's time grain, when declared. */
  grain?: string;
  /** The period this cell belongs to, when the row is keyed by a time field. */
  period?: string;
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
