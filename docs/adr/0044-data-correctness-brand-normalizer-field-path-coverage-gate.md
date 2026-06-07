# ADR-0044 — Data Correctness: Brand Normalizer, Field Path as Compiler Primitive, Coverage Gate

**Status:** Accepted
**Date:** 2026-06-04
**Deciders:** binchenz

## Context

Three independent correctness gaps were identified during an architecture review:

1. `brand_share` and `model_metric` join on the `brand` string dimension at query time. AVC source
   data may spell the same brand differently across sheets (e.g. "小米" vs "Xiaomi"). Without
   normalisation, cross-star queries silently return incomplete results — no error, just missing rows.

2. Cross-relationship traversal is implemented in two places with two different mechanisms:
   - DSL compiler (`compiler.ts`): correlated subquery, used for derived properties and permission
     predicates.
   - Query planner service (`buildCrossRelSql`): explicit JOIN, used for aggregate `groupBy` only.
   The two mechanisms have different edge-case behaviour. `resolveRelationByName` uses `findFirst`
   without a `sourceTypeId` constraint, so two relations with the same name but different source
   types in the same tenant return a non-deterministic result. Correctness cannot be guaranteed at
   a single point.

3. `avc_report` provenance rows are written at ingest but never consulted at query time. A query
   over a (品类, period) with no matching report, or with `coverage = 'essence'` when the question
   requires the model layer, returns an empty result set that is indistinguishable from a real zero.

## Decisions

### 1 — Brand Normalizer

Introduce `normalizeBrand(raw: string): string | null` in `@omaha/shared-types`, structurally
identical to `normalizeCategory`. Applied at ingest time on every `brand` field written to
`brand_share` and `model_metric`. Returns `null` for unknown brands; the importer skips and logs
unknown brands rather than writing a row that can never join.

**Rejected alternative — fuzzy match at query time:** Fuzzy matching at query time is
non-deterministic (threshold tuning), adds latency to every query, and obscures whether two rows
represent the same brand or genuinely different ones. Normalisation at ingest is deterministic and
auditable.

### 2 — Field Path as DSL Compiler Primitive (A1)

Make `relationName.fieldName` a first-class concept inside the DSL compiler, not a bolt-on in the
query planner service layer. Concretely:

- The compiler's `emit()` function gains a `resolvePath(path: string[])` step that, for a
  two-segment path `[relation, field]`, emits a JOIN rather than a correlated subquery.
- `resolveRelationByName` is fixed to constrain by `sourceTypeId` (eliminating the `findFirst`
  non-determinism).
- The existing `buildCrossRelSql` JOIN in the planner and the compiler's correlated-subquery
  aggregate node are both **retired** and replaced by the single compiler path.
- Maximum depth: 2 hops (enforced at parse time; deeper paths return a compile error, not slow SQL).
- v1 scope: one cross-relationship path per query. v2 will relax to multiple.

**Upgrade path to A2 (ObjectSet algebra):** A1 is a strict subset of A2. A2's `searchAround`
produces a new ObjectSet whose `filter` layer calls A1's path compiler. A2's `intersect`/`union`
wrap SQL `INTERSECT`/`UNION` over A1-compiled queries. No A1 code needs to be rewritten for A2;
A2 adds an outer composition layer. The migration is additive, not a rewrite.

**Rejected alternative — keep traversal in the planner service layer:** Each new traversal
use-case (filter, sort, derived property, permission predicate, pipeline transform) requires a
separate implementation. Edge-case behaviour is guaranteed only per call-site, not structurally.
The non-deterministic `findFirst` bug would need to be fixed in every call-site independently.

### 3 — Coverage Gate

At query time, before returning any Market Metric, Brand Share, or Model Metric result, join
`avc_report` for the requested `(category, period)`. Two rules:

- If no matching AVC Report row exists → fail explicitly with `AVC_REPORT_NOT_FOUND`.
- If `coverage = 'essence'` and the query touches the model layer (Model Metric or a Derived
  Property over it) → return a structured warning `ESSENCE_COVERAGE_MODEL_UNAVAILABLE` before
  answering, so the Agent can surface "this period is essence-only" rather than misreading 0 rows.

The gate lives in `ResearchSdk` (the single write+read path for market intelligence data), not in
individual query tools, so it cannot be bypassed.

**Rejected alternative — let callers handle missing data:** Callers (Agent tools) cannot
distinguish an empty result caused by a data gap from a genuine zero. The Agent would answer "0"
or "no data" with false confidence.

## Consequences

- `normalizeBrand` must be seeded with the brand vocabulary observed in real AVC data before
  ingesting any `brand_share` or `model_metric` rows. Unknown brands are logged at ingest time.
- Field Path depth limit (2 hops) means queries like `a.b.c.field` are rejected. This is
  intentional: Postgres join-plan quality degrades sharply on three-way self-joins over JSONB.
- Coverage Gate adds one `avc_report` lookup per market-intelligence query. At the expected
  volume (tens of queries per session) this is negligible.
- The two pre-existing traversal implementations (compiler subquery + planner JOIN) become
  dead code once A1 is implemented; they must be deleted, not left dormant.
- ADR-0013 ("instance relationships JSONB dormant") is superseded: the `relationships` column
  is actively read by both the include path and cross-relationship aggregation. Update ADR-0013
  status to Superseded.

## Implementation Status (2026-06-06)

**Decision 2 (Field Path / A1) — IMPLEMENTED.**

Canonical `relationships` JSONB convention confirmed and enforced:
- **Key** = relationship name (unique per `(tenant, sourceType, name)`)
- **Value** = target's `external_id` (not UUID `id`)
- **fkSide** resolved by the unified `resolveRelationByName` (constrained by `currentType` on both sides — eliminates `findFirst` non-determinism)

All readers aligned: compiler `exists`/`count`/`aggregate`, include path, cross-rel aggregate planner, and the new Field Path filter. All writers aligned: seed, drone-relay fixture, scenario-builder, derived-property e2e fixtures.

Field Path is a first-class AST node (`{ kind: 'path', relation, field }`) in `@omaha/dsl`:
- Parser: `relation.field` syntax, depth limited to 1 hop (parse-time error for `a.b.c`)
- Analyzer: validates relation in `knownRelations`
- Compiler: emits scalar subquery based on `fkSide`
- Filter integration: `scoped-where.ts` detects dot in `field`, compiles via path node

Upgrade path to A2 (ObjectSet algebra) preserved: filters accept only scalar predicates (including cross-path scalars); collection operations will use a separate query field.

## Amendment (2026-06-06) — Coverage Gate moves to the generic query path

Decision 3 placed the Coverage Gate in `ResearchSdk` "so it cannot be bypassed."
On implementation the premise proved false: `ResearchSdk` owns only `searchResearch`
(semantic retrieval over **document chunks**, Asset B). The structured star objects the
gate must guard — `market_metric` / `brand_share` / `model_metric` — are read through the
generic `query_objects` / `aggregate_objects` Tools → `QueryService`, which never touches
`ResearchSdk`. The gate's stated home was not on the path it guards; the `research_qa` skill
compensated with **prose** ("query `avc_report` first"), which is exactly the rejected
"let callers handle missing data" alternative — enforceable only by the LLM remembering.

**Revised placement:** the gate lives in `QueryService` (every read of those types flows
through it, so it genuinely cannot be bypassed) but does **not** hardcode the three type
names. A `ProvenanceGate` collaborator is injected into `QueryService`; `QueryService`
depends on its interface, never on `avc_report`. The gate holds a **code-defined registry**
(in the research module, beside the `*_DEF`s) keyed by type name →
`{ provenanceType, categoryField, periodField, modelLayer }`. Not a column on `ObjectType`
(no annotation column exists, and nothing tenant-configurable varies here — coverage is a
fixed property of the AVC archive format). One adapter ⇒ a code registry, not a DB-backed
declarative seam; promote to a column only when a second provenance use-case appears.

**Keys on requested scope, not on `sourceReport`.** A pre-flight runs before/independent of
the result rows (the whole point: an empty result is the case the gate exists to disambiguate,
and empty rows carry no `sourceReport`). So the gate reads `category` (+ `period`/`month`)
off the **Query Plan filters**. `sourceReport` remains the per-row provenance stamp; it is
not the gate's key.

**Per-matched-report semantics** (coverage flips per report over time, so a single-period
requirement would reject the legitimate "across all periods" question):
- Scope matches **zero** `avc_report` rows → fail `AVC_REPORT_NOT_FOUND` (a genuine
  never-ingested gap, distinct from essence).
- A **model-layer** query (`modelLayer: true`, i.e. `model_metric`) whose scope matches one
  or more **essence** reports → attach a structured `ESSENCE_COVERAGE_MODEL_UNAVAILABLE`
  warning **naming which period(s) are essence-only** (a set, not a boolean), so the Agent
  says "26.04 is essence-only; model data needs an earlier full period (23.12)".
- `brand_share` / `market_metric` never warn on essence — those layers are present in both
  Coverage variants.

`QueryObjectsResponse.meta` gains a `warnings?: string[]` channel to carry the warning
(`AggregationResponse` already has `warnings`). Decisions 1 (Brand Normalizer) and 3's
ingest-time pieces remain future work; this amendment covers only the read-path gate.
