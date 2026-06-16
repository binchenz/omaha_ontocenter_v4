# Omaha OntoCenter — Domain Context

Ontology-native platform for querying and acting on business objects via natural language. MVP focus: order/payment/review/customer/task for SMB commerce.

The platform is **not** a commercial end-product sold to enterprises directly. It is tooling for an **OPC** who privately deploys it for an SMB, models that SMB's business into an Ontology, and hands off a working data-querying Agent. The product is organised into task-shaped **Surfaces** (consume / maintain / create / Pipeline), each with its own interaction model; which Surfaces a person sees follows the **tasks their Role authorizes**, not who they are. Two interaction-model families span those Surfaces — **design-time** (modeling: reverse-inference, Draft editing, Evals, Publish) and **runtime** (querying: read-only NL Q&A over the published Ontology). See `docs/adr/0030-opc-design-runtime-split.md` (the concept) and `docs/adr/0038-surfaces-follow-tasks-roles-authorize.md` (surface←task / authz←role).

## Language

**User**:
A person with a platform account — includes both active operators (boss, ops, customer service, admin) and login-disabled accounts created solely to be assignable as task owners or order owners. Every assignable human in the system is a User; there is no separate Employee entity.
_Avoid_: Employee, Staff, Member, Account

**Role**:
A tenant-scoped named set of **Permissions** a User holds. The single axis that governs authorization: which tasks a User may perform, and within what scope, is a function of their Role — never of which Surface they are on (ADR-0038). The OPC/SMB-developer/boss distinction is a Permission distinction, not a separate identity. Seeded roles: `admin` (`*`), `operator` (query-only), `opc` (explicit design-time grant).
_Avoid_: Group, Persona, Audience

**Permission**:
A `resource.action` capability string carried on a Role (e.g. `object.query`, `ontology.design`, `ontology.publish`, `reverse-inference.run`). The wildcard `*` grants all; `resource.*` grants every action on a resource. The single source of truth for the permission→capability mapping is the pure `hasCapability` / `surfacesFor` / `isDesignTimeUser` functions in `@omaha/shared-types`, imported by every consumer (front-end nav, Skill assembly, the write-authz gate) so they cannot drift. A Permission may also carry a `:fields` scope (field-level visibility, ADR-0036) and a row-level **Predicate** condition. Write/design-time Permissions are enforced at one service/SDK gate that both the HTTP and Agent paths pass through (ADR-0040).
_Avoid_: Scope, Grant, ACL, Capability (informally fine, but "Permission" is the term)

**Tenant**:
An isolated workspace for one enterprise customer. Every data row, query, and action is scoped to exactly one tenant.
_Avoid_: Workspace, Organization, Company

**Ontology**:
A tenant's configured catalog of Object Types, Properties, Relationships, Derived Properties, and Actions. Per-tenant; the platform ships with no built-in business objects.
_Avoid_: Schema, Model

**Object Type**:
A tenant-defined class of business entity (e.g. `Order`, `Customer`, `Payment`). Object Types are tenant-scoped; the platform never hard-codes them. `object_types` is a **domain-only namespace**: every row is a business entity the runtime Agent may legitimately surface. Test probes, fixtures, and any non-domain artifact must never be written to it — they live in throwaway tenants or transaction-rolled-back scopes, never on a real tenant's runtime read path. This invariant is what lets the Agent's schema menu list **every** type without filtering (see _Schema Menu_): the floor of "what exists" stays clean by construction, so completeness never means leaking junk to the LLM.
_Avoid_: Entity type, Class, Table

**Object Instance**:
A single row representing one business entity. Every Object Instance (Order, Payment, Review, …) is stored as one row in the shared `object_instances` table, identified by `(tenant_id, object_type, external_id)`. Child objects are **not** nested in their parent's JSONB — they are first-class rows that reference their parent via `relationships`.
_Avoid_: Record, Row, Document

**Derived Property**:
A property whose value is computed from a DSL expression at query time, not stored. Declared in the Ontology by the tenant admin; compiled by the query engine into SQL. Can be parameterized (e.g. `isPaidAt(cutoffTime)`) and can reference other Derived Properties on the same Object Type (small DAG). See `docs/adr/0001-derived-property-dsl.md`.
_Avoid_: Computed field, Virtual column, Formula

**Semantic Annotation**:
Optional metadata on Object Types, Properties, and Relationships that encodes business meaning beyond structural type information. Comprises `description` (one-sentence business meaning) and `unit` (measurement unit for numeric properties). Auto-inferred by the Agent during modeling; consumed by the LLM via schema summary injection to disambiguate natural language queries. Not visible to end users in the UI — purely an AI-facing context layer.
_Avoid_: Metadata, Tag, Label (those mean different things here)

**Schema Menu**:
The Agent-facing projection of the **Ontology** into the runtime system prompt, split into two tiers along a single load-bearing invariant: **existence is never truncated, only detail is lazy**. **Tier 0** (the menu) lists *every* Object Type as one `name — description` line and is always injected in full — the Agent must always know which types exist, because not knowing produces wrong-star routing and invisible-wrong-answers, not an error. **Tier 1** (the detail) is the full property/relationship spec of a single type, pulled on demand via `get_ontology_schema(typeName)` once the Agent has chosen a type from the menu. Truncation may only ever fall on Tier 1 (fetch-on-need), never on Tier 0 (the type names). This invariant only holds if `object_types` stays a clean catalog of **domain** Object Types — test/probe types must never be written to it. Above a few hundred types the menu narrows by **Surface** (list only types the surface's Skills can reach); large-scale semantic retrieval of the menu is a deferred escape hatch, not the current design. See `docs/adr/0050-schema-menu-existence-never-truncated.md`.
_Avoid_: Schema summary (that is the old single-tier, truncated-by-slice implementation this replaces)

**Query Plan**:
A declarative description of a query over Object Instances — Object Type, filters (including Derived Property references with bound params), includes, selects, pagination. Generated by the NL module or the query UI; compiled by the query engine; never hand-written SQL.

**DimensionConstraintEnforcer**:
The single seam that enforces ADR-0057 dimension constraints before any Query Plan compiles. One `apply(args, view)` call does two jobs: it auto-injects **defaulted dimensions** as `eq` filters when a query left them unconstrained (e.g. priceBand=整体), and it rejects a query that omits a **required dimension** with a structured `DIMENSION_REQUIRED` error carrying the field and its *scoped* available values (periods that exist for the already-filtered category, not all periods). All three plan paths (regular / aggregate / cross-relationship aggregate) route through it, so a new plan path cannot silently skip the gate. This is what stops the Agent from silently averaging across periods — the multi-period invisible-wrong-answer trap. Extracted from QueryPlannerService as a deep module (the planner calls it in one line). See `docs/adr/0057-dimension-constraints.md`.
_Avoid_: Dimension validator, Filter guard

**TransformConfig**:
A tenant-owned, versioned, append-only configuration asset for reusable data transform logic (brand normalization dictionaries, price band thresholds). Referenced by PipelineSteps via `(name, version)` binding to ensure immutable lineage: re-running a PipelineRun six months later uses the exact same rules. Type-specific schemas validated at creation (`brand_mapping`, `price_bands`). Never updated in place; updates append a new version. See `docs/adr/0054-transform-config-versioned-immutability.md`.
_Avoid_: Config template, Transform dictionary, Mapping asset

**PipelineStep**:
One stage in a Pipeline's transform DAG. Enum-constrained types (ADR-0053): `filter` (single condition, compose via multiple steps), `rename` (column renaming), `compute` (predefined functions). Config is JSON Schema-validated at Pipeline creation to prevent runtime failures — **never raw SQL**, even after the DuckDB engine upgrade (ADR-0060): the step stays a declarative, enum-bounded config and the engine generates the SQL internally. Compute steps may reference TransformConfig via `configRef` + locked `configVersion`, or inline params directly. The MVP vocabulary (`normalize_brand` / `price_band`, single-table, in-memory) is being widened by ADR-0060 to `explode_json` / `dedup` / `aggregate` / `join` on a DuckDB engine; `join` is **multi-input only** and exists solely for fact×fact merges (fact×dimension stays out of the Pipeline — see _Pipeline_).
_Avoid_: Transform step, Stage, Operation
_Avoid_: Query, SQL

**Aggregation**:
A summary view of multiple Object Instances reduced to one or more numeric or categorical metrics, optionally grouped by property values. Produced by the aggregate operation, **not** the query operation. Does **not** contain Object Instance fields (`id`, `externalId`, `relationships`). Returned shape is `{ groups: [{ key, metrics }], totalGroups }`. Permission predicates are applied to the underlying rows before aggregation, so an Aggregation can never include rows the caller cannot read; field-level masking does not apply because no instance fields are returned. The aggregate operation is audited as `object.aggregate` (separate from `object.query`); the groupBy + metrics shape is recorded but the returned numbers are not.
_Avoid_: GroupBy result, Stats, Summary, Reduce

**Predicate**:
A value-typed expression that yields a boolean for a single Object Instance row. Internally `{ ast, view, params, scope }` — already parsed, with its Ontology view resolved, parameters bound, and scope fixed to either the parent row or a correlated child row. Produced by two sources — user filters inside a **Query Plan**, and permission conditions on a Role — and consumed by exactly one compiler. Serializable; safe to persist in audit logs or hand to the NL module for explanation.
_Avoid_: Filter expression, Condition, Rule (in code; "condition" is still fine in user-facing copy)

**OntologyView**:
The resolved runtime view of an Object Type for a given tenant — properties (with types / filterable / sortable / precision / scale), derived properties, and the set of relations out of it. Loaded once per request rather than re-queried per **Predicate**.
_Avoid_: Ontology cache, Resolved ontology

**Visible View**:
A per-principal projection of an **OntologyView**, narrowed to the fields a caller may see, produced by `projectVisible(view, allowedFields)`. A masked field is dropped from every capability set (filterable / sortable / numeric / …) so the existing input gates reject a reference to it exactly as they reject a non-filterable or absent field — no existence oracle. A **Derived Property** survives only if every base field in its transitive dependency closure is visible. `allowedFields = null` (the common, all-visible case) returns the view unchanged. This is the input-seam half of field-level permission; the output-seam half is `toInstanceDto`, which masks an **Object Instance**'s returned properties (mask-before-`select`). Both consume the resolver's `allowedFields`; neither touches a compiled **Predicate**, which carries its own full view and may legitimately reference fields the end user cannot see. See `docs/adr/0036-field-level-visibility-enforcement.md`.
_Avoid_: Masked view, FieldMask (no value type — the set is threaded directly), Filtered view

**ObjectInstanceScope**:
The single module that emits the `FROM object_instances WHERE tenant_id = ? AND deleted_at IS NULL` prefix (parent form) and its correlated-subquery form (child form). The invariant gate for ADR-0006's soft-delete rule; all read paths must pass through it.
_Avoid_: Instance reader, Instance query helper

**Action**:
A named, controlled operation a user (or an AI agent on their behalf) can execute on a single Object Instance. Declared per Object Type in the Ontology with typed parameters, a DSL precondition, and declarative **Effects**. The MVP lifecycle is `Discover → Validate Precondition → Preview (dry-run) → Confirm → Execute → Audit`. Actions are first-class Ontology citizens — the Agent discovers available Actions via `get_ontology_schema` and triggers them via `execute_action`. Scope is ontology-internal: field writes + relationship mutations + object creation, all within one transaction. No external API calls in v1. See `docs/adr/0048-ontology-expressiveness-actions-computed-graph.md`.
_Avoid_: Command, Mutation, Operation

**Action Effect**:
A single declarative step within an Action's execution. Four kinds: `set_field` (update a property value), `create_relationship` (link to another Object), `delete_relationship` (unlink), `create_object` (instantiate a new Object Type). Effects are interpreted sequentially by the ActionExecutor into `ObjectEdit[]` and delegated to `ApplyService` — they are data, not code. The list of Effects is what the user sees in the confirmation preview.
_Avoid_: Side effect, Handler, Mutation step

**Action Parameter**:
A typed input that the caller must supply when triggering an Action. Types: `string`, `number`, `date`, `boolean`, `objectRef` (reference to another Object Instance by type). Parameters flow into Effects via `{ fromParam: 'paramName' }` bindings. An `objectRef` parameter is the mechanism for relationship-creating Actions ("assign to which sales rep?").
_Avoid_: Argument, Input field

**Preview** (of an Action):
A dry-run invocation of an Action Handler that produces an ActionPlan, persists it as an `ActionPreview` row, and returns a `previewId` plus a hash of the plan. Required before Execute.
_Avoid_: Simulation, Dry run (standalone — use "Action Preview" or just "Preview")

**Connector**:
A tenant-configured adapter that pulls raw rows from an external source (CSV, Excel, MySQL, PostgreSQL) into the platform. A Connector's sole responsibility is ingestion — it produces a **Dataset** (raw), not Object Instances directly. Transform and mapping logic live downstream.
_Avoid_: Data source, Integration

**Dataset**:
A tenant-owned, persistent, versioned snapshot of tabular data — the unit of data that Pipelines transform and Mappings consume. Every Dataset has a declared schema and a lineage record (which Connector or Pipeline step produced it). Discriminated by an explicit `kind` column: **raw** (produced directly by a Connector) or **clean** (produced by a Pipeline Run, or by a caller that pre-cleans data before ingestion). Object Types bind to a clean Dataset, not to a Connector source table directly. Datasets are immutable snapshots — each Connector refresh or Pipeline Run produces a new versioned row (`@@unique([tenantId, name, version])`), never mutating previous versions. The Sync Job guard hard-fails on `kind !== 'clean'`. Datasets are the platform's answer to the data-quality problem: dirty source data is cleaned in a Pipeline before it ever reaches Object Instances.
_Avoid_: Table, Staging table, Intermediate result

**Pipeline**:
A tenant-configured, declarative DAG of transform steps that produces a clean **Dataset** from one or more raw Datasets. Each step is a named, reusable transform (normalise free-text, deduplicate, join, compute column). The Pipeline is the platform's T layer — it is where the OPC encodes data-cleaning rules that would otherwise be hand-written scripts re-done on every maintenance visit. Lineage is recorded at the step level: any field in a clean Dataset can be traced back through the Pipeline to its source column. Pipelines are design-time artifacts (OPC-authored, workbench-managed); they run automatically when the upstream raw Dataset is marked ready. A Pipeline binds to a **Connector** (input) and targets one **Object Type** (output); multiple Pipelines may share a Connector (one per Object Type). Steps execute in-memory; only the final result is materialised as a new clean Dataset (immutable lineage — raw is never mutated). See `docs/adr/0045-pipeline-architecture-immutable-lineage.md`.

The transform **engine** is being upgraded from in-memory `Row[]` (10k-row ceiling, single-input) to **DuckDB** (in-process columnar SQL, ~10M-row class, zero new infra) — ADR-0060. Three boundaries that grill settled and that the engine upgrade does NOT change: (1) **fact × dimension does not belong in the Pipeline** — code tables / lookups / profiles are modelled as dimension Object Types and decoded at query time via Field Path (ADR-0044), never JOINed into a fact wide-table (dimensions change, wide-tables would need full reload; this is the ontology's edge over the warehouse). Pipeline `join` is **fact × fact only**. (2) **Multi-input trigger = "model 1′"**: all declared inputs must have a ready version before a run fires; default aligns on *latest ready* (correct for fact × slow-changing-dimension), but a Pipeline may declare an optional **`alignKey`** (e.g. `reportMonth`) that switches to *same-key-all-present, JOIN only same-key versions* — the guardrail against fact × fact cross-batch mis-pairing (an invisible-wrong-answer otherwise). (3) **This trigger logic is deliberately the *minimal* subset of a scheduler's dependency-alignment primitive** — the platform explicitly does NOT grow into a scheduling platform (no cron / backfill / DAG / SLA); it is reactive (markReady-driven), and full scheduling is delegated to an external scheduler calling platform APIs. The **A/B split**: platform-internal DuckDB cleaning (A, default, ≤~10M rows) and external cleaning fed in via `kind='clean'` (B, the permanent escape hatch for billion-row / Spark-class / a tenant's own ClickHouse) are *complementary, not opposed* — they share the `kind='clean'` ingress. ClickHouse lives at the **Connector** layer (a future pull Connector landing a clean Dataset), never as a swappable transform engine; pushdown federation is explicitly out-of-scope.
_Avoid_: ETL script, Transform job, dbt model

**Pipeline Run**:
A single execution of a **Pipeline**. Triggered reactively by the `DataPipelineOrchestrator` when a raw Dataset is marked ready. Reads all rows from the input raw Dataset, executes Pipeline steps in-memory sequentially, and writes the final result as a new clean Dataset (immutable — each run produces a new versioned snapshot, named `${pipeline.name}_clean`). Has its own pg-boss queue (`pipeline-run`), independent retry/status from Sync Jobs. On success, the orchestrator auto-enqueues a Sync Job on the output clean Dataset. On failure, records structured error details; permanent failures do not retry.
_Avoid_: Pipeline execution, Transform run, Pipeline job

**Mapping**:
A per-Object-Type declaration that binds an Object Type to a clean **Dataset** and maps Dataset columns to Object Type properties and relationships. Owns the sync strategy (`full` or `incremental`). A Mapping no longer points at a Connector source table directly — the Dataset is the stable, clean interface between the data layer and the ontology layer.
_Avoid_: Integration, Connector mapping

**IngestRecipe**:
A declarative, code-defined description of how to materialise one Object Type from a single-shot snapshot of a source database. Lives in `scripts/`, not in tenant configuration. Names which source rows to read, how to map each row to an Object Instance, and (optionally) how to resolve parent references and entity-resolution lookups. Distinct from **Mapping**: a Mapping is tenant-configured infrastructure that runs on a schedule via Connector + Pipeline + Sync Job; an IngestRecipe is engineer-authored code that runs once during a customer onboarding (per ADR-0015). Distinct from **Pipeline**: a Pipeline is a tenant-owned, persisted transform DAG with lineage; an IngestRecipe is a one-shot `scripts/` artifact with no materialised Dataset or lineage — it is the lightweight stand-in the platform Pipeline now supersedes for tenant-configured ingestion.
_Avoid_: IngestPass, Recipe (standalone)

**Sync Job**:
One execution of a Mapping against a specific clean **Dataset** version. Carries both `datasetId` (which snapshot to read) and `mappingId` (how to map columns → properties) explicitly. Reads Dataset rows, applies the Mapping's `propertyMappings`, and upserts Object Instances via ImportEngine (the single write path, ADR-0040). All-or-nothing: if any row fails validation the entire batch is rejected. Runs on its own pg-boss queue (`sync-job`), separate from the Pipeline transform queue. Transient errors retry (3×, exponential backoff); permanent errors (validation, schema) fail immediately. The trigger chain is: Pipeline completes → orchestrator enqueues Sync Job on the output clean Dataset. Direct-clean callers (no Pipeline) enqueue explicitly. See `docs/adr/0045-pipeline-architecture-immutable-lineage.md`.
_Avoid_: Import, Run, Ingestion job

**consumeQueue**:
The shared seam every pg-boss queue worker subscribes through (`consumeQueue(boss, queue, handler)` in `dataset/pg-boss.provider.ts`). It owns the one load-bearing pg-boss v10 lifecycle invariant — `createQueue()` must complete before `work()`, or sent jobs are silently dropped — plus the per-batch job fan-out, so the rule lives in exactly one place rather than being re-derived in each worker's `onModuleInit`. Both the **Pipeline Run** worker and the **Sync Job** worker route through it; a future queue consumer gets the correct lifecycle for free. The worker keeps its own domain logic (which row to fetch, how to process, transient-vs-permanent error classification); only the queue plumbing is shared.
_Avoid_: Queue base class, Worker framework

### Agent Layer

**Surface**:
A task-shaped face of the product (consume / maintain / create / Pipeline), each with its own interaction model. Surfaces follow **tasks** and are visible to a User per the tasks their **Role** authorizes — `surfacesFor(permissions)` derives the set (ADR-0038/0041). On the front end a Surface is a URL segment plus a `SurfaceContext`; switching Surface does not unmount the conversation. A Surface drives **Skill** assembly, and a **Conversation** records the Surface it was created on (fixed for its lifetime, so its Skill set stays stable). The Surface/nav layer is the shallow UX layer of the boundary, never the authorization gate.
_Avoid_: Page, Tab, View, Mode, App

**Agent**:
The conversational AI that is the platform's primary user interface. A single LLM-driven loop — one Agent across all Surfaces (ADR-0039), not one per Surface — that understands user intent, activates Skills, calls Tools via the SDK, and streams responses. Operates within one Tenant's Ontology. See `docs/adr/0008-agent-first-architecture.md`.
_Avoid_: Bot, Assistant, Copilot

**Skill**:
A domain capability package the Agent loads for a turn. Contains a system prompt fragment, a subset of available Tools, and optional workflow guidance. Code-defined, not tenant-configurable. Examples: data ingestion skill, ontology design skill, query skill. **Assembled per request from `{permissions, surface}`** (ADR-0039/0041): the declared Surface narrows which Skills load; absent a Surface the all-active union holds (ADR-0010). This assembly is a relevance + least-privilege layer, **not** the security gate — a wrongly-scoped Skill is a UX/accuracy regression, not a vulnerability; the write-authz gate (ADR-0040) is the real boundary. When a Skill is withheld for lack of permission, the Agent is given opening guidance to say so up front rather than fail late.
_Avoid_: Plugin, Module (in agent context), Capability

**Tool**:
An atomic operation the LLM can invoke via function calling. Stateless, single-purpose. Examples: `create_object_type`, `query_objects`, `import_data`. Defined as JSON Schema; executed by the agent loop; results fed back to the LLM.
_Avoid_: Function, Command, API call (in agent context)

**Tool Registry**:
The discovery seam between Tool implementations and the Agent's orchestration loop. Each module that owns Tools self-registers them by spreading `ToolRegistryModule.providers(...ToolClasses)` into its own `providers` array and exporting `AGENT_TOOLS` — the Agent module collects all registered Tools via a single `@Inject(AGENT_TOOLS) tools: AgentTool[]` without knowing which modules contributed them. Ownership stays with the domain module (ActionModule owns `CreateActionTool`; DataImportModule owns `ExecuteImportTool`); the Registry only provides the collection point. Adding a new Tool is two edits in one module: (a) create the tool file, (b) add it to the module's providers via `ToolRegistryModule.providers()`. Skills remain pure value objects with no DI; they reference tools by `name` string, not by class. See `docs/adr/0052-tool-registry-module-self-registration.md`.
_Avoid_: Tool factory, Tool provider list

**SDK (Ontology SDK)**:
The ontology-aware typed interface layer between Tools and underlying services. Tools call SDK methods; SDK calls OntologyService/QueryService/etc. Provides the Agent with a unified view of the current Tenant's Ontology without exposing internal service details. Lives in core-api as an internal module.
_Avoid_: API client, Service layer (in agent context)

**Conversation**:
A persistent dialogue session between a User and the Agent. Stores the full sequence of turns (user messages, agent responses, tool calls, results) for audit and context. Records the **Surface** it was created on — fixed for its lifetime, so the Agent's Skill set stays stable even if the User navigates elsewhere (ADR-0041 §3). The Agent dynamically compresses older turns when feeding history to the LLM.
_Avoid_: Chat, Session, Thread

### Delivery Roles

**OPC** (One Person Company):
The single operator — typically a data-analyst-background freelancer — who privately deploys the platform for one SMB client, interviews the client to understand the business, models it into an Ontology, loads the client's data, tunes query accuracy, and hands off a working Agent. The OPC is the platform's primary **design-time** user, but not the *only* possible one — design-time access follows **Permissions**, so an SMB developer granted them can also model (ADR-0038). Modeled on Palantir's **FDE**. The platform's goal is to maximize OPC delivery throughput, not to close a commercial loop itself.
_Avoid_: FDE (use OPC in this codebase; FDE is the external reference model), Consultant, Integrator

**FDE** (Forward Deployed Engineer):
The external reference model (Palantir) that OPC workflows are designed against. An engineer embedded at a customer who models the domain into an ontology, ships a working app fast, and iterates on feedback — backed by tooling for fast modeling, closed-loop validation (Evals/preview), and branch-based change review. Used in design discussions; not a code entity.
_Avoid_: (don't use as a code identifier — it's a design touchstone)

**Design-time** vs **Runtime**:
Two interaction-model families, **not** two audiences (ADR-0038 supersedes ADR-0030's people-binding). **Design-time** is the modeling interaction: schema reverse-inference, ontology editing on a Draft, accuracy Evals, template instantiation, publish. **Runtime** is the querying interaction: read-only natural-language Q&A over the published Ontology. They have different interaction models, histories, and security boundaries — but each is reached per **task** (via the matching **Surface**) and gated per **Role**, so an SMB developer with the right Permissions can reach design-time tasks, not only the OPC.
_Avoid_: Build-time, Edit mode / Query mode (those are narrower); "design-time = OPC, runtime = SMB" (the audience-binding ADR-0038 removed)

**Ontology Draft**:
A mutable working copy of a Tenant's Ontology that the OPC edits, reverse-infers into, instantiates templates into, and validates with Evals — before promoting it to the live Ontology via Publish. Exactly two states exist per Tenant: the live **published** Ontology that the runtime Agent reads, and at most one **Draft**. Discarding a Draft is the rollback mechanism. (Lightweight two-state model, not full version history — see `docs/adr/0031-ontology-draft-publish-state.md`.)
_Avoid_: Branch (no multi-branch), Version (the `version` Int is just an optimistic-lock counter), Snapshot

**Publish** (of an Ontology Draft):
The OPC-initiated promotion of a Draft to the live Ontology, after which the runtime Agent sees the changes. The one moment design-time changes become visible to runtime users.
_Avoid_: Deploy, Release, Commit

**Accuracy Eval**:
A reusable, productized batch probe (generalizing the ad-hoc N=8 probe of ADR-0029) that runs a set of representative natural-language questions against a Draft's Agent and scores whether the generated Query Plans are correct — the OPC's objective go/no-go evidence before Publish. Modeled on Palantir's AIP Evals.
_Avoid_: Probe (that was the throwaway script), Test, Benchmark

### Market Intelligence (纯米, ADR-0042)

The domain language for the market-research application built for prospect 纯米科技 (Chunmi). Two assets are joined on a declared **品类/价格段 spine** (category / price-band), with **no NER** — the spine is confirmed, never guessed. The ontology here is **decision-first**: its object grain is chosen to answer a real decision chain (trend → share-decline → price-band attribution → competitor-new-product), not to mirror the source spreadsheet tab-by-tab.

**AVC Report**:
A monthly online-market monitoring spreadsheet from 奥维云网 (AVC), one per (品类, report-month). Comes in two **Coverage** variants. The provenance source for all structured market objects; never itself an Object Type (it is provenance, per ADR-0042). Every AVC Report **declares its own 品类 in the 目录 sheet title** (`《AVC-<品类>-线上...报告》`, R1, merged across C2:C6) — this is the file's authoritative category, present and parseable in 100% of the archive. The filename (`avc-YY_MM-NN.xlsx`) carries only a period + opaque sequence index `NN` and is **not** a category source; deriving category from `NN` (e.g. `NN % 10` into a fixed cycle) is the bug ADR-0058 fixes — it mislabeled 40/50 files because upload order differed per period.
_Avoid_: Excel, Workbook, Source file

**Category Drift** (AVC renames mid-archive):
AVC's declared 品类 name for a tracked universe can **change between report cycles**, and an old/new name pair never co-occurs in the same period — so the 目录 title alone does not give a stable canonical key; it must fold through `normalizeCategory`. Three drifts observed at the **24.12** cycle, and they are **not the same kind of event** — the distinction is load-bearing for trend honesty: (1) **微波炉 → 台式单功能微波炉** is a pure rename — same universe (零售额 −10%, brand roster nearly identical), so 台式单功能微波炉 aliases to 微波炉. (2) **料理机/破壁机 → 食品料理机** is a narrowing (料理机 ⊃ 破壁机); both alias to 食品料理机 but a cross-boundary trend silently mixes a wide and a narrow scope. (3) **电烤箱 → 台式复合机** is a genuine universe change, **NOT** a rename: 零售额 collapsed 61% (21,287→8,281 万元), 2-7 sub-types flipped from oven form-factors (嵌入式/台式) to steam-combo functions (微蒸烤/蒸烤), and the brand roster turned over (老板/方太/西门子 out, 东芝/松下/小米 in). Therefore 台式复合机 is its **own canonical category** (电烤箱: 22.12–23.12; 台式复合机: 24.12–26.04 — two distinct short series), never aliased to 电烤箱: a continuous oven trend across that break would falsely read as a 61% market collapse.
_Avoid_: aliasing 台式复合机→电烤箱, deriving category from filename index, treating all AVC renames as continuous

**Coverage** (of an AVC Report):
How deep a given (品类, month) report goes. **full** (数据报告, 32 sheets) carries the model/SKU layer (2-7) and new-product layer (2-9); **essence** (精华版, 10 sheets) stops at the brand/price-band layer (2-6) — no model layer. Coverage is **per-report, not per-category, and it flips over time**: 空气炸锅/养生壶/料理机 were full at 22.12–23.12 then dropped to essence from 24.12 on — so a category-level Coverage flag would lie. It is stamped on each AVC Report's provenance row (per 品类×月) so the Agent can say "this period is essence-only, drill to SKU needs an earlier full period" instead of misreading 0 model rows as either a data gap or a real zero.
_Avoid_: Tier, Level, Detail

**Market Metric** (`market_metric`):
The market-size star object — (品类, month, metric, value), extracted from sheet 2-1. The coarsest grain; a time series because months are pivoted across 2-1's columns.
_Avoid_: Size row, Sales row

**Brand Share** (`brand_share`):
The brand-competition star object — (品类, brand, price-band, month, metric=share, value), extracted from sheet 2-5. AVC computes share against the **whole market** at its own price-band cuts; one report = one month's snapshot, so a trend is built by stamping each report with its cover month and stacking periods.
_Avoid_: Competition row, Share table

**Model Metric** (`model_metric`):
The finest-grain star object — one TOP-100 model/SKU per (品类, model, brand) carrying its own per-month 销额份额/销量份额, **零售均价**, 加热方式, 上市日期, extracted from sheet 2-7. The object that makes the decision chain answerable: drill to the SKU whose share fell, band it by its own 均价, and read 上市日期 to tell a new entrant from an incumbent. **Three-star coexistence** (ADR-0042 amendment): Model Metric does NOT replace Brand Share — the two are different sampling universes (TOP-100 sample vs whole-market), so brand/band share is never re-derived by summing models; each star binds directly to its own sheet, and roll-ups happen in the query layer.
_Avoid_: SKU row, TOP model, deriving brand share from models

**Price-band attribution** (model ↔ brand-share):
A model's **零售均价** is stored as a continuous value, NOT pre-bucketed into a band. To answer "which price-band fell" → "which SKU in that band fell", the Agent takes the band's `[min,max]` interval from the Brand Share side and filters models at query time (`均价 >= min AND 均价 < max`). This keeps ADR-0042's "do not reconcile to one canonical band set" intact — no side fixes a canonical segmentation; either side's interval can filter the other because **价格段 is an interval, not a label** (see `parsePriceBand`). 净水器 and 电饭煲 have wildly different AVC cuts, so freezing one set would be wrong.
_Avoid_: bucketing models into bands at ingest, a canonical band set

**Brand Normalizer**:
A pure function `normalizeBrand(raw: string): string | null` that maps variant spellings of a brand name (e.g. "小米"/"Xiaomi"/"小米科技") to a single canonical form, returning `null` for unknown brands. Applied at ingest time on `brand_share.brand` and `model_metric.brand` so that cross-star joins at query time are stable. Same structural pattern as `normalizeCategory`. Without this, brand-dimension alignment between Brand Share and Model Metric is silent — two rows representing the same brand will never join.
_Avoid_: brand alias table, fuzzy match at query time

**Field Path**:
A dot-separated traversal expression `relationName.fieldName` (e.g. `order_legs.deliveryMode`) that crosses one Relationship hop to read a property on a related Object Type. At most 1 hop deep (enforced at parse time). Compiled by the DSL compiler into a scalar subquery — the `path` AST node in `@omaha/dsl`. All DSL binding points (user filters, permission predicates, derived properties, pipeline transforms) automatically gain cross-relationship capability because they all route through the same compiler. One cross-relationship path per aggregate groupBy in v1; filters support multiple paths already. Canonical instance-link convention: `relationships: { <relationName>: <target external_id> }` (ADR-0044 §2). Implemented 2026-06-06.
_Avoid_: dot-path (use Field Path), join hint, cross-table filter

**Coverage Gate**:
A query-time check that joins the `avc_report` provenance row for the requested (品类, period) before returning Market Metric, Brand Share, or Model Metric results. If no matching AVC Report exists the query fails explicitly rather than returning an empty set. If coverage is `essence` and the question requires the model layer (2-7), the Agent surfaces "this period is essence-only" before answering. Prevents silent zero-rows from being misread as real zeros or data gaps.
_Avoid_: silent empty result, missing-data assumption

**New entrant** (a model that is "new this period"):
NOT a stored object or flag — a **derived judgement** over Model Metric's **上市日期**: a model is a new entrant relative to a report month when `上市日期 ∈ [报告月 − N, 报告月]` (N tunable, e.g. last 3 months). AVC ships its own pre-judged "本期新品" sheet (2-9), but we deliberately do NOT extract it: 上市日期 already lives on every 2-7 model row, so "is it new" is a Derived Property (computed, not stored — consistent with the platform's Derived Property principle), the window is explainable and tunable (AVC's window is an opaque black box), and it stays consistent across full periods rather than depending on 2-9's presence. Requirement ④ ("did a competitor launch a new product in some band and grab share") is then one query over Model Metric: `上市日期 ∈ last-N AND 均价 ∈ band-interval AND share rising`.
_Avoid_: a new_model object, an isNewThisPeriod stored flag, extracting sheet 2-9

## Relationships

- A **User** belongs to exactly one **Tenant**
- A **User** holds exactly one **Role**; a **Role** carries a set of **Permissions**, both scoped to the Tenant
- The **Surfaces** a User sees are derived from their **Permissions** (`surfacesFor`); authorization to perform a task follows the **Role**, never the Surface (ADR-0038)
- An **Ontology** belongs to exactly one **Tenant**
- An **Object Instance** is an instance of one **Object Type** within a tenant's **Ontology**
- A **Derived Property** is declared on an **Object Type** and resolved at query time
- A **Query Plan** targets one **Object Type** and may reference its **Derived Properties**
- An **Action** is declared on an **Object Type** and run by its **Action Handler**
- **Preview** of an **Action** produces an **ActionPlan**; **Execute** consumes it
- An **Agent** operates within one **Tenant**'s **Ontology**, calling **Tools** via the **SDK**
- A **Skill** exposes a subset of **Tools** and is assembled per request from the User's **Permissions** and current **Surface**
- A **Conversation** belongs to one **User** and one **Agent** session, and records the **Surface** it was created on
- A **Tool** invokes **SDK** methods; the **SDK** delegates to underlying services (OntologyService, QueryService, etc.)
- Write/design-time **Permissions** are enforced at one service/SDK gate shared by the HTTP and Agent paths (ADR-0040)
- An **OPC** typically performs **design-time** tasks and SMB end users **runtime** tasks, but both are reached per **task** (**Surface**) and gated per **Role**; all act within one **Tenant**
- An **Ontology Draft** belongs to one **Tenant**; **Publish** promotes it to that Tenant's live **Ontology**
- An **Accuracy Eval** runs against a **Draft** and gates **Publish**

(`Order`, `Customer`, `Payment`, `Review`, `Task` etc. that appear in PRD §7.2 are **example** Object Types used for the demo tenant — they are not platform-level concepts.)

## Example dialogue

> **Dev:** "The PRD says Action `createReviewFollowUpTask` has `assigneeId` with `ref: Employee`. We don't have Employee — should I use User?"
> **Domain expert:** "Right, everyone assignable is a **User**, even warehouse staff who never log in. The PRD wording predates that decision. Use User."

> **Dev:** "Permission rule `salesOwnerId = {{user.id}}` — does that match the logged-in person?"
> **Domain expert:** "Yes. Current **User** == order's salesOwner **User**. No indirection."

> **Dev:** "When the user says '帮我导入这个 Excel', should the Agent call the import Tool directly, or does it need to go through a Skill first?"
> **Domain expert:** "The Agent activates the data-ingestion **Skill**, which knows the workflow (create Connector → infer schema → confirm → Mapping → Sync). The Skill exposes the relevant **Tools** in sequence. The Agent doesn't freestyle — the Skill provides the guardrails."

> **Dev:** "Is the SDK just a wrapper around our existing services?"
> **Domain expert:** "Yes, but ontology-aware. A **Tool** calls `sdk.queryObjects(...)` — the **SDK** resolves the Object Type from the current Tenant's Ontology, applies permissions, and delegates to QueryService. Tools never touch services directly."

### Open-Source Deployment (ADR-0049)

**Deployment model**: Self-hosted only (v1). Each OPC deploys one instance for one SMB. The codebase's multi-tenancy is preserved but a single Tenant is the default operational unit — OPCs do not need to understand the Tenant concept.

**Setup Wizard**: On first boot (no Tenant seeded), the platform redirects to `/setup`. Two steps: (1) DeepSeek API Key + connectivity test, (2) tenant name + admin email + password. The wizard calls a single `POST /setup/initialize` endpoint that creates the Tenant, seeds the `admin` Role, and creates the first User. After completion, the wizard redirects to `/login`. `JWT_SECRET` is auto-generated at first boot; `DATABASE_URL` is managed via Docker Compose and hidden from the wizard (advanced users can override via `.env`).

**User management**: Admin users can create, delete, and assign Roles to Users from a Settings page — no CLI required. Role _editing_ (changing Permissions) remains CLI/code-level for v1 (high-risk operation). The user creation form in the wizard's final step reuses the same Settings page component.

_Avoid_: multi-tenant onboarding UI (v1 is single-tenant by default), self-service registration (all Users are admin-created)

## Flagged ambiguities

- "Employee" in PRD §5.1 and §7.6 (`ref: Employee`) — **resolved**: there is no Employee concept; all assignable humans are **User**. Login-disabled Users cover staff who never use the platform.
