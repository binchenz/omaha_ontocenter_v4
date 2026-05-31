---
status: accepted
---

# Data-plane and authorization convergence: one write path, one TCB, table-agnostic compiler

## Context

ADR-0037 (Dataset/Pipeline plane), ADR-0038 (surfaces←task / auth←role), and ADR-0039 (one Agent, surface-driven Skills, transform dry-run) fixed the *shapes* but explicitly deferred the load-bearing mechanics. A gap analysis of the actual code against those three ADRs surfaced two facts that turn the deferred questions from "later" into "decide before any data-plane code is written":

1. **The `Connector → Mapping → Sync Job` chain ADR-0037 talks about "rebinding" never existed as runnable code.** It is 100% schema-only stubs (`Connector`/`ObjectMapping`/`SyncJob` tables, CRUD services, no engine). The data that actually reaches `object_instances` today flows through a *different*, unmentioned path: `Agent → import_data tool → ImportEngine.importFile()` (parse → `allowedValues` gate → direct upsert). So building ADR-0037 is not "modify the chain" — it is "build the chain for the first time, and decide what happens to `ImportEngine`."

2. **Write authorization does not exist today.** Reads are gated (`PermissionResolver.resolveOrThrow` in `query.service`), but every write/design-time path — `create_object_type`, draft edit, **Publish**, reverse-inference, evals — is guarded only by `JwtAuthGuard`. An `operator` (or any authenticated SMB user) can publish an ontology. This is an open hole, not a missing feature; ADR-0035's "#77 enforcement" was the placeholder for it.

This ADR records the five interlocking decisions that resolve ADR-0037/0038/0039's deferred mechanics, validated against Palantir's production agent-security model (which is structurally the same: the LLM is never the security boundary; enforcement lives at the Ontology/data layer under the invoking user's identity; tool-scoping is least-privilege relevance, not a gate).

## Decision

### 1. One write path — subsume `ImportEngine` into the Dataset plane

`ImportEngine`'s three fused responsibilities split and move to their proper homes: **parse** → Connector (produces a raw Dataset); **`allowedValues` validation** → the Dataset→instance hop (normalise/quarantine); **upsert** → Sync Job. After this, *every byte that reaches `object_instances` flows through `… → Dataset → Sync Job`*, and the hard-constraint gate lives in exactly one place. Rejected: keeping `ImportEngine` as a parallel "fast path" (option B) — it reintroduces the two-write-paths / two-gates duplication that ADR-0037 chose the full plane (option 丙) specifically to kill. `ImportEngine` is the *only* writer today, so this is the cheapest moment to redirect it; every month of conversational-ingestion features calcifies the direct path.

### 2. Dataset = materialised, versioned JSONB rows; a transform *is* a query plan

A Dataset is stored as generic JSONB rows (`dataset_rows(tenant, dataset_id, version, columns JSONB, …)`) — the *same physical shape* as `object_instances` (ADR-0002). Therefore a **transform step is a SQL-over-JSONB query that writes a new Dataset version**, and the Pipeline execution engine is not new code — it is the *second binding point* of the query engine's compiler. Rejected: table-per-Dataset (re-loses ADR-0002's DDL-per-artifact argument — stronger here, since raw Datasets carry arbitrary source schemas) and object-store/Parquet (introduces a second storage substrate + external compute the Postgres-only platform doesn't have — the Foundry team-scale heaviness ADR-0037 explicitly disclaimed; over-built for 10⁴–10⁶-row SMB data).

**No ML-in-execution escape hatch for MVP.** The intelligence in data cleaning lives in *authoring* a transform's parameters (e.g. an LLM proposes a `mood: 329→5` normalisation map; OPC dry-run confirms; the confirmed map lands as a SQL join), never in the per-row execution hot path. An external/ML step type can be added later without breaking the single-substrate model.

### 3. Reconvergence — MVP transforms are key-preserving by construction; the key invariant is named for later

The two ADR-0037 legs (honesty: reverse-inference on raw FKs → relationships; quality: Pipeline → clean Dataset → data) must reconverge at the Mapping, and a grain-changing transform (dedup, join) can sever the join keys the honesty leg grounded its `metadata` relationships on. MVP avoids this *by construction*: the transform catalogue ships only within-row column operations (normalise, compute-column, type-fix) that physically cannot touch an `externalId`/FK column; a transform targeting a relationship-bound key column is rejected at authoring time (same discipline as the `allowedValues` gate). Grain-changers are deferred, and when they arrive they land a **key-preservation invariant** (a transform that re-grains a key emits a key-remapping every dependent Sync applies) — *not* re-derivation on the clean layer, which ADR-0032/0037 already forbid (clean Datasets have no FKs → every relationship collapses to `heuristic`, destroying the honesty core).

### 4. Write authorization — one TCB at the service/SDK convergence point

The single source of truth for write authorization is the **service/SDK layer where both entry points converge** (`POST /ontology/...` HTTP and `Agent → tool → SDK` both bottom out in the same service method), reusing the existing `PermissionResolver` that already gates reads. A controller-layer guard is at most a shallow fast-fail, **not** the source of truth — because the Agent (the platform's primary surface, ADR-0008) bypasses controllers entirely, so any controller-only scheme leaks on the main path. This is exactly the hole today. This mirrors Palantir: permissions defined once at the Ontology layer, enforced under the invoking user's identity across every access path (SDK / Action / query / agent), the LLM's tool choice never being the boundary.

### 5. Skill-assembly is a relevance layer, not in the TCB — with honest opening guidance

Skill/tool assembly is **not** a second authorization source of truth (that would reintroduce the drift decision 4 eliminates). It is a relevance + least-privilege layer: it narrows the tools the LLM sees so it isn't polluted with unusable capability (protecting plan accuracy, ADR-0028/0029) and so the declared surface (ADR-0039) drives which Skills load. A leaked tool is a UX/accuracy regression caught by evals, **not** a vulnerability — the service-layer TCB (decision 4) is the deterministic gate. Assembly consults the *same* `PermissionResolver` in read-only form, so there is no second judgement to drift. **Increment over Palantir:** because we are an OPC-delivered product where multiple SMB roles share one Agent at runtime (not an FDE wiring one AIP Logic block at design time), tool-scoping is assembled *per-principal at runtime*, and an over-privileged request becomes *opening guidance injected into the LLM* ("creating an Object Type is a design-time capability requiring modelling permission; you are a data-consumption role — I can help you query instead") rather than a runtime `ForbiddenException` the LLM apologetically wraps after the fact. This extends the project's honesty discipline (ADR-0026/0029) to the interaction layer: never look capable without being authorized.

## Considered Options

- **Two write paths / two gates (B)** — rejected (decision 1): duplication ADR-0037's 丙 was chosen to eliminate.
- **Table-per-Dataset / object-store Datasets** — rejected (decision 2): re-loses ADR-0002's argument / imports Foundry team-scale substrate the single-OPC product disclaimed.
- **Re-derive relationships on the clean layer** — rejected (decision 3): forbidden by ADR-0032/0037; destroys the FK-grounded honesty core.
- **Controller-guard as the authorization source of truth** — rejected (decision 4): the Agent bypasses controllers, so it leaks on the primary surface — the present hole.
- **Skill-assembly as a second security layer (defense-in-depth)** — rejected (decision 5): a second source of truth that must stay consistent with the service TCB or drift; the deterministic service gate already makes the extra layer's security value marginal while adding a permanent consistency burden.

## Consequences

- **One architectural-level refactor, and it is also overdue cleanup:** the query compiler's `object_instances` binding (`compiler.ts` `exists`/`count` subqueries, `scope.ts` `emitScope`, the direct `FROM object_instances` in `query-planner.service.ts:186,332`, the fragile regex in `scoped-where.ts:54`) must be parameterised (table / JSONB column / tenant·id·deleted columns / parent alias) so the same compiler targets `dataset_rows`. This restores ADR-0007's intent that `emitScope` is the *single* authority — currently violated by the scattered fragments. ~70% of the compiler is already table-agnostic (it threads an opaque `scope` string).
- **Everything else is additive on existing seams:** the Dataset/Pipeline plane is new schema + services (reusing `ImportEngine`'s parse/validate logic); write authz extends `PermissionResolver` to a second caller set (write paths), not a new mechanism; skill narrowing lands on the tool-scoping seam ADR-0010 deliberately preserved and ADR-0039 designated.
- **One semantic schema change:** `ObjectMapping` rebinds from `connectorId + tableName` to `datasetId`. Cheapest now, while it is still a CRUD-only stub with no engine.
- **`allowedValues` enforcement consolidates** at the Dataset→instance hop (decision 1); the Publish preflight gate (ADR-0031) remains as defence-in-depth.
- **ADR-0037/0038/0039 deferred items resolved:** Dataset storage/versioning mechanism (→ decision 2), transform execution model + catalogue shape (→ decisions 2–3), the two `allowedValues` homes' relationship (→ decision 1), and the ADR-0035 #77 enforcement *what/where* (→ decisions 4–5). Still deferred: the concrete transform-step catalogue contents, incremental Pipeline re-execution, the full per-surface permission matrix, transform-preview sampling strategy, and the front-end surface scaffolding (the app today is three independent pages with no surface concept; chat≈consume and ontology≈maintain exist, create/pipeline do not).
- **The write-authz hole is the highest-priority item** of everything above — it is a live vulnerability (any authenticated user can Publish), not a missing capability.
