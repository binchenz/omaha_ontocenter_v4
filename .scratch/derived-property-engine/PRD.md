---
status: needs-triage
created: 2026-05-04
---

# PRD: Derived Property Engine for Object Query

## Problem Statement

Tenant administrators have configured Object Types in the Ontology and synced data into `object_instances`, but they cannot ask the platform the kinds of questions the product was built to answer. The PRD §9 reference query — "yesterday before 19:00 in Hangzhou, paid by 11am today, latest review positive, give me the details" — relies on Derived Properties (`isPaidAt(cutoffTime)`, `latestReviewIsPositive`) and aggregation across child objects (Payments, Reviews). Today's `QueryService` only supports eight scalar JSONB operators against a single object, so:

- The flagship demo question cannot be answered. There is no way to express "exists a Payment for this Order with `paidAt <= cutoff`," let alone the more nuanced "sum of payments ≥ totalAmount."
- Admins who declare `derivedProperties` in `ObjectType` see the field accepted and saved, but it is silently ignored at query time. The platform's Ontology promise is broken at the boundary that matters most.
- All filters perform sequential JSONB scans. No facility exists for admins to flag fields as "filterable" so the platform can build expression indexes; performance degrades linearly with row count and is already a risk near PRD §10.1's 100k-row threshold.
- Permission `condition`s in PRD §7.7 are documented in filter-shaped DSL but cannot be enforced because the query layer has no DSL compiler.

## Solution

Introduce a Derived Property Engine that compiles tenant-declared DSL expressions into SQL fragments at query time, layered onto the existing `object_instances` storage. The engine ships as three coordinated pieces (per the grill outcome):

1. **A reusable DSL package** that parses, validates, and compiles expressions into parametrized SQL fragments. It is a pure library — no I/O, no Prisma — and is independently testable.
2. **An index manager** that reconciles Ontology-declared "filterable" / "sortable" property flags against actual Postgres expression indexes on `object_instances`, creating and dropping indexes as the Ontology evolves.
3. **A query planner** that consumes a Query Plan plus the active Ontology and the actor's permissions, and produces a single compiled SQL query with all derived properties expanded as correlated subqueries / `LATERAL` joins, permission conditions AND-ed in, soft-deleted rows filtered out, and `include` / `select` projections honored.

These three sit behind the existing `POST /query/objects` endpoint. Hand-written Query Plans and LLM-generated Query Plans (ADR-0005) take the same path. Plan 4 ships in three steps so each piece can be reviewed and merged independently:

- **4a — Index manager + Ontology declaration extension**: smallest, independent value; speeds up existing simple queries even before DSL lands.
- **4b — DSL package**: pure library; full unit-test coverage drives the bulk of confidence.
- **4c — Query planner integration**: glues 4a + 4b into `QueryService`, supports `include` / `select` / aggregation, and runs the PRD §9 reference query end-to-end.

## User Stories

1. As a tenant admin, I want to declare `isPaidAt(cutoffTime: datetime) := exists payments where status = 'Success' and paidAt <= cutoffTime` on the Order Object Type, so that ops users can ask time-sliced payment questions without me building a custom SQL view.
2. As a tenant admin, I want the Ontology to reject a Derived Property whose expression references a property or relationship that does not exist on the Object Type, so that I find typos before they become silent query failures.
3. As a tenant admin, I want to define one Derived Property in terms of another on the same Object Type (e.g. `latestReviewIsPositive` reading `latestReview`), so that I can compose semantic concepts.
4. As a tenant admin, I want the platform to refuse a Derived Property that introduces a cycle in the dependency graph, so that the engine cannot recurse forever at query time.
5. As a tenant admin, I want to flag `Order.fulfillmentCity` as "filterable", so that filtering on it after sync uses a real index rather than a sequential scan.
6. As a tenant admin, I want the platform to drop the expression index automatically when I un-flag a property, so that index storage stays aligned with what the Ontology says is filterable.
7. As a tenant admin, I want to declare `precision` and `scale` on a decimal property, so that aggregations across thousands of payments produce stable, correctly-rounded numbers.
8. As a tenant admin, I want the platform to refuse a permission rule whose `condition` exceeds a static complexity score, so that one bad rule cannot quietly slow down every query for that role (per ADR-0003).
9. As a tenant admin, I want a permission rule's audit row to record the **instantiated** filter (with `{{user.id}}` substituted), so that I can tell what the rule actually evaluated to during an incident.
10. As an ops user, I want a query that filters on `isPaidAt = true` with `cutoffTime = "2026-05-04T11:00:00+08:00"`, so that I see exactly the orders the boss asked about — and I want the same query to return zero rows, not an error, when no orders match.
11. As an ops user, I want a query that filters on `latestReviewIsPositive = false` with `include: ['latestReview']`, so that I get the latest Review object inline with each Order without a follow-up request.
12. As an ops user, I want a query that filters on `count(items) >= 3 and sum(payments.amount) >= 500`, so that I can find high-value multi-item orders directly from the UI.
13. As an ops user, I want pagination, sorting on a flagged sortable field, and filtering composed in one request, so that the result table is stable and reproducible.
14. As an ops user, I want a clear error when I attempt to filter on a property that the admin has not flagged as filterable, including a hint explaining what to ask the admin to change.
15. As an ops user, I want soft-deleted Object Instances excluded from every query I run, so that the result counts match what the source system reports today (per ADR-0006).
16. As a sales user, I want my row-level permission `salesOwnerId = {{user.id}}` automatically applied to every query I run — including queries that already have other filters — so that I cannot accidentally see another sales rep's orders even if I craft the Query Plan myself.
17. As a customer-service user with a permission rule that uses a Derived Property (`latestReviewIsPositive = false`), I want my queries scoped to those orders without me having to repeat the rule, so that the system enforces the policy uniformly.
18. As a developer, I want the DSL compiler to emit a parametrized SQL fragment plus a parameter list, so that the same fragment can be embedded in user filters, permission conditions, and Action preconditions without re-parsing.
19. As a developer, I want the DSL compiler to expose a static dependency analysis (which fields, relationships, and other Derived Properties are referenced), so that the Ontology validator and the permission complexity scorer can use it.
20. As a developer, I want every query to include `deletedAt IS NULL` automatically through a single enforcement point, so that no service can accidentally leak soft-deleted rows.
21. As a developer, I want the query planner to assemble all subqueries — derived property aggregations, permission conditions, includes — into one SQL statement, so that a single round-trip serves the whole Query Plan.
22. As a developer, I want a deterministic E2E test that submits the PRD §9 reference query against seeded data and asserts the exact returned rows, so that regressions in any of the three pieces surface immediately.
23. As an admin reviewing audit logs, I want each query row to include the compiled SQL hash and the resolved parameter list (with permission templates substituted), so that I can replay exactly what the database executed.
24. As a tenant admin, I want a manual "Full Resync" button visible on every Mapping (per ADR-0006) so I can re-establish baseline after an incremental sync misses deletes — and I want subsequent queries to immediately reflect the resync without cache staleness.
25. As a tenant admin, I want the Ontology validator to surface a clear error when a property uses an operator the DSL does not support (e.g. regex match in MVP), so that I do not discover the limit only at query time.

## Implementation Decisions

**Module structure (accepted):**

- **`@omaha/dsl`** (new pnpm package): pure parser + analyzer + compiler. Public surface kept narrow — `parse`, `analyze` (returns dependencies + complexity score), `compile(ast, ctx) → { sql, params }`. No Prisma, no NestJS dependencies. This is a deep module: years of language work hide behind three functions.
- **`index-manager`** (new core-api service): one public method, `reconcile(tenantId, objectTypeId)`. Reads Ontology declarations (filterable/sortable flags), inspects `pg_indexes` for the existing expression-index set on `(tenant_id, object_type, (properties->>'<field>'))`, creates and drops to converge. Idempotent. DDL execution is internal.
- **`query-planner`** (new core-api service, extracted from `QueryService`): consumes `(QueryPlan, Ontology, ActorPermissions)` and returns `{ sql, params, projection }`. Owns derived-property expansion (uses `@omaha/dsl`), permission condition compilation (also `@omaha/dsl`), soft-delete injection, `include` / `select` flattening. Stateless; no I/O.
- **`query.service`**: thin I/O boundary. Calls `query-planner`, runs `prisma.$queryRaw`, maps rows to response DTOs, enforces field-level permission masking (already implemented).
- **`ontology` module**: extends `PropertyDefinition` schema with `filterable: boolean`, `sortable: boolean`, `precision: int?`, `scale: int?`. Extends `DerivedPropertyDefinition` with `expression: string` (DSL source) and runs `dsl.analyze` on save to validate references and reject cycles. Calls `index-manager.reconcile` after every successful save.
- **`permission.service`**: stores `condition` as DSL source. On query path, calls `query-planner` to compile each rule. Rejects on save when `dsl.analyze` returns complexity above threshold.

**DSL semantics (per ADR-0001):**

- Operators: `=` `!=` `<` `<=` `>` `>=` `in` `like`; boolean `and` `or` `not`; arithmetic `+` `-` `*` `/`; aggregation `count` `sum` `avg` `min` `max`; relation iteration `exists <rel> where <pred>`, `not exists`; relation reduction `maxBy <rel>.<field>` `minBy` `first` `last`.
- Field paths: same-Object-Type properties, 1-hop relationship traversal (`customer.region`), references to sibling Derived Properties.
- Parameters: typed (`datetime`, `decimal`, `string`, `int`, `boolean`); bound at query time from the Query Plan's `params` block.
- Null propagation: missing values in aggregates coalesce to type zero (`0` for numeric, empty for `count`). Not configurable.
- Decimal handling: compiler reads `precision` / `scale` from Ontology and casts JSONB extraction to `decimal(p, s)`. Refuses to compile arithmetic on a decimal property without precision declared.

**Permission compilation (per ADR-0003):**

- Permission `condition` is the same DSL surface as user filters.
- Template variable whitelist: `{{user.id}}`, `{{user.roleId}}`, `{{user.tenantId}}`, `{{now}}`. Template substitution happens at compile time, before SQL generation. Anything outside the whitelist is a compile error.
- Audit row records `effectivePermissionFilter` — the post-substitution DSL source — for every query.

**Query plan composition:**

- Top-level shape stays compatible with the existing `QueryObjectsRequest` DTO. `filters[]` entries can now reference Derived Properties by name with optional `params` block. New fields: `include[]` (list of relationship names), `select[]` (list of dot-paths).
- All Object Instance reads filter `deletedAt IS NULL` automatically. A reserved internal `includeDeleted: true` flag exists for audit replay only; the public DTO does not surface it.
- Generated SQL is one statement per request: base scan over `object_instances` for the target Object Type, with `LATERAL` subqueries for each derived property and each `include` relationship, and `WHERE` clauses combining user filters and permission conditions.

**Schema changes:**

- `ObjectType.properties` items: add `filterable: boolean`, `sortable: boolean`, `precision: int?`, `scale: int?`. Migration is additive (default false / null).
- `ObjectType.derivedProperties` items: add `expression: string`, `params: [{ name, type }]`. The current placeholder stays a JSONB array.
- `ObjectInstance`: add `deletedAt: timestamp?` with index `(tenant_id, object_type, deletedAt)`. Migration is additive.
- `Role.permissions` rule entries: extend `condition` to accept DSL source string in addition to today's structured shape; both forms compile through the planner. Old structured rules continue to work unchanged.
- Audit log: new column `effective_permission_filter` (JSONB), new column `compiled_sql_hash` (text).

**API contracts:**

- `POST /query/objects` request gains `params`, `include`, `select`. Response unchanged in shape; `meta` gains `compiledSqlHash` for audit traceability.
- New `POST /ontology/object-types/:id/derived-properties/validate` returns `{ valid: boolean, dependencies: [...], complexity: number, errors: [...] }` so the admin UI can pre-flight an expression.
- New `POST /ontology/object-types/:id/reconcile-indexes` returns the diff (`created: [...], dropped: [...]`); called automatically after Ontology save and exposed manually for incident recovery.

## Testing Decisions

**Principle.** Tests assert observable behavior at module boundaries — DSL inputs to compiler outputs, request DTOs to response DTOs, Ontology declarations to actual index existence. They do not assert internal AST shapes, parser intermediate states, or specific Prisma calls. A passing test should survive any refactor that preserves the public contract.

**`@omaha/dsl` — full unit coverage (table-driven).**

- Hundreds of `(input, expected)` cases organized by feature: each operator, each aggregation, each relation form, parameter binding, null propagation, decimal casting, error shapes for every diagnostic.
- Includes adversarial inputs: cycles in derived-property dependencies, undeclared identifiers, type mismatches, division-by-zero shape, parameter-arity mismatches, illegal template variables.
- Snapshot tests for compiled SQL fragments are acceptable here because the package version-locks its output format; a snapshot diff is a deliberate API change.
- Prior art: `apps/core-api/src/modules/ontology/ontology.service.spec.ts` shows the table-driven DTO validation style; extend that pattern.

**`query-planner` — unit tests with fixture Ontology + permissions.**

- No database. Inputs: `(QueryPlan, fixture Ontology, fixture permissions)`. Outputs: compiled SQL string + params array + projection map.
- Coverage targets: derived property expansion, permission AND-ing, soft-delete clause injection, `include` `LATERAL` shape, `select` dot-path flattening, error on filtering an unflagged field, error on referencing an unknown derived property.
- Prior art: `query.service.spec.ts` (Plan 3 work) demonstrates jest-based unit isolation for the same module family; same setup, swap PrismaService mock for a fixture loader.

**`index-manager` — integration tests against real Postgres.**

- Uses the same Postgres container the existing E2E suite runs against. Creates a temp `object_instances` table or uses a clean tenant slice.
- Scenarios: declare two filterable fields → expression indexes appear; un-flag one → corresponding index dropped; declare again → same index name reused; concurrent reconcile calls converge to the same state. Inspects `pg_indexes` for verification, not internal manager state.
- Prior art: `apps/core-api/test/*.e2e-spec.ts` already runs against a live database via Testcontainers / docker-compose; reuse the same harness.

**Query-engine E2E — PRD §9 reference query.**

- One test that seeds the demo tenant with the example Order, Payments, Reviews; declares `isPaidAt`, `latestReview`, `latestReviewIsPositive`; submits the natural-language reference query as a hand-written Query Plan (no LLM); asserts the exact set of returned Order ids and their `latestReview` fields.
- Additional E2E cases: the same query under a permission scope that excludes the result; the same query when one Payment is soft-deleted; the same query with `include: ['customer', 'items', 'payments', 'latestReview']` exercising every relationship form.
- Prior art: `apps/core-api/test/query.e2e-spec.ts` (Plan 3) — extend it.

**Out-of-band but worth noting:**

- Performance baseline tests (1k, 10k, 100k seeded rows of Orders + 3× Payments each) are valuable but **not gating** for Plan 4 merge. Capture numbers and file follow-ups; do not block on hitting PRD §10.1 targets in this iteration.

## Out of Scope

- **LLM-driven Query Plan generation.** Plan 4 only deals with hand-written Query Plans submitted to `POST /query/objects`. The natural-language path (ADR-0005) is a separate Plan that depends on this one being merged.
- **External-API Action calls.** ADR-0004 explicitly defers `nonRevocable` external calls to V1.1; Plan 4 does not touch the Action engine at all.
- **CDC / binlog sync.** ADR-0006 defers to V2; Plan 4 reads `object_instances` as is.
- **Cost-based query rejection.** Static complexity scoring on permission rules is in scope; runtime cost estimation and rejection of expensive user queries is V1.1.
- **`updateObjectType` migration of existing instances** when a property's `precision` or `type` changes destructively. Forward-compatible additions only; destructive Ontology evolution is its own future PRD.
- **User-defined function support in DSL.** ADR-0001 defers to V2.0.
- **Custom prompt templates per tenant.** ADR-0005 defers; not relevant here anyway.
- **Frontend changes.** PRD §6.2 query plan visualization, §8 page designs — out of scope for Plan 4. The API is built to support them; the UI ships separately.
- **Performance tuning beyond the index manager.** Async export for queries above the 100k row threshold (PRD §10.1) is a follow-up; the current Plan documents the limit and surfaces it as a deliberate constraint.

## Further Notes

- Plan 4 splits into 4a (index manager + Ontology declaration extensions), 4b (`@omaha/dsl` package), 4c (query-planner integration + E2E). Each ships independently; 4c is the integration step that turns on the headline capability.
- The DSL is the longest-lived contract in this PRD. Once tenants store expressions in their Ontology, breaking syntax changes are migrations. Plan 4b should treat the grammar as v1.0 and version it explicitly in the package.
- Permission DSL compilation reuses the same compiler as user filters (ADR-0003). Both sites must be regression-tested whenever DSL semantics change — make this explicit in `@omaha/dsl`'s release checklist.
- The decision to keep `object_instances` as a single table (ADR-0002) is what allows `LATERAL` subqueries to reach child rows by `relationships->>'parentId'`. If sharding or per-Object-Type tables ever return as a discussion, Plan 4's compiler will need a new path; flag this in any future ADR that supersedes 0002.
- Soft-delete enforcement is a system-wide invariant introduced here (ADR-0006). Anywhere else in the codebase that reads `object_instances` directly — not just query-planner — must be audited and updated.
