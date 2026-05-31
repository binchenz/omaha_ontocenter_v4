---
status: accepted
---

# OPC/runtime role-auth model: permission-derived surfaces, defense-in-depth enforcement

## Context

ADR-0030 split the product into two disjoint faces — an **OPC** (one-person-company operator) design-time workbench and an **SMB runtime** query-only Agent — but only at the product/UX level. The access-control layer was deferred to #77 (HITL), which was blocked on a human decision recorded here (#79). The OPC design-time toolchain (ADR-0031–0034, shipped in PR #78) added a whole set of design-time endpoints — `/ontology/draft`, `/ontology/draft/publish`, `/ontology/draft/preflight`, `/ontology/templates*`, `/evals/*`, `/reverse-inference` — all of which are currently guarded only by `JwtAuthGuard`. So today **any authenticated user can create/publish drafts, run reverse-inference, and manage templates**, and the agent assembles all three skills (query, data-ingestion, ontology-design) for everyone.

What already exists to build on:

- A tenant-scoped `Role` model (`packages/db/prisma/schema.prisma`) with a JSON `permissions` array. Seed defines `admin` (`['*']`) and `operator` (`['object.read','object.query','action.preview']` — query-only).
- `CurrentUser` (`@omaha/shared-types`) already carries `roleName` and a parsed `permissions: string[]` / `permissionRules: RolePermission[]`, populated by `JwtStrategy` on every request.
- `tenantId` is derived from the JWT and scopes every query; the deployment is single-tenant-per-OPC-engagement.

What is missing: no `RolesGuard`/`@Roles()`, no role-driven skill assembly, no surface gating in the web app, and the runtime/design boundary is nowhere enforced server-side.

This decision must also relate to the **known field-level permission bypass**: the query-planner receives row-level `permissionPredicates` but never an `allowedFields` whitelist, so masking is applied post-query (`filterMaskedFields` in `query.service.ts`) and `filter`/`sort`/`groupBy`/aggregate stages can still leak a masked field's values (binary-search via `WHERE`, or `groupBy` the masked column). Recorded in project memory as de-scoped under the pilot trust model.

## Decision

Adopt three coupled decisions.

### 1. Distinguish surfaces by the permissions a role already carries (no new schema)

Do **not** add a `surface` column or separate login apps. Derive the surface from `CurrentUser.permissions`: a role holding any **design-time permission** is an OPC; a role with only query/read permissions is a runtime user. The existing `admin`/`operator` seed maps cleanly (admin's `*` ⇒ design-time; operator's query-only ⇒ runtime).

Introduce **named permission constants** for the design-time actions in `@omaha/shared-types` (single source of truth, reused by guard + skill assembly + frontend), e.g. `ontology.design`, `ontology.publish`, `data.ingest`, `evals.manage`, `reverse-inference.run` — plus a derived helper `isDesignTimeUser(permissions)` / `designSurfaceFor(user)`. The wildcard `*` grants all. Seed gains an explicit design-time grant on `admin` (and/or a dedicated `opc` role) so the OPC's permissions are declarative, not implicit in `*`.

Rationale: zero migration, reuses the resolver path that already exists, and keeps the boundary expressed in the same permission vocabulary the query layer already speaks. The risk that someone edits a role's permissions and drifts the boundary is acceptable under a single trusted operator and is itself the explicit control surface.

### 2. Enforce the boundary defense-in-depth (API is the boundary, not the UI)

The runtime/design separation is enforced at **four layers**, so a runtime user cannot reach design-time capability even by crafting raw API calls:

- **Route guard** — a `RolesGuard` (+ a `@RequiresPermission(...)` decorator reading the constants from §1) blocks the design-time controllers/endpoints (`/ontology/draft*`, `/ontology/templates*`, `/evals/*`, `/reverse-inference`) for users lacking the corresponding permission. Returns 403, audit-logged.
- **Skill assembly** — the agent assembles skills from the caller's permissions: a runtime user's agent is constructed with the query skill only and literally does not have the `ontology-design`/`data-ingestion` tools in its tool set. The current static `AGENT_SKILLS` factory becomes permission-driven per request.
- **Data visibility** — drafts, templates, eval questions, and any unpublished ontology state are invisible to runtime users (the design-time read paths are behind the same guard; runtime read paths continue to read only the published `object_types`/`object_relationships`, per ADR-0031).
- **Frontend surface** — `(app)/layout.tsx` and the nav hide design-time pages (`/ontology` workbench affordances, ingestion) for runtime users; runtime users see only the query/chat surface. This is the UX layer of the same boundary, never the only layer.

Rationale: the pilot is single-tenant-trusted *today*, but the whole point of formalizing the split is to make it a real boundary that survives the introduction of an untrusted runtime role. Enforcing only in the UI would make the "split" cosmetic and would have to be redone the moment trust narrows.

### 3. Field-level permission bypass: document and defer, with an explicit P0 trigger

> **SUPERSEDED by ADR-0036 (enforce now).** This decision deferred the fix behind a P0 trigger; the project owner instead chose to enforce field-level visibility immediately. The bypass is now closed at the query seam via a visible-view projection (`projectVisible`) at the input gates plus a single output materializer (`toInstanceDto`), and the include path resolves child visibility + predicates. The "deferred fix" sketch below is what ADR-0036 actually implemented. Retained for history.

Do **not** change the query-planner in this pass. ADR-0035 records the bypass and its precise trigger: it becomes **P0 the instant a runtime role that is not fully trusted with all field values is introduced into a tenant** (e.g. outsourced support, a distributor, a temp). Until then, the documented pilot premise ("no untrusted roles within the tenant") holds and no planner change ships here.

The deferred fix, when triggered: thread the resolver's `allowedFields` into `PlanArgs` and enforce it in the planner's `filter`/`sort`/`search`/`groupBy`/`metrics` stages (reject or drop references to non-allowed fields) — moving masking from post-query projection to plan-time, closing the `WHERE`/`groupBy` leak. The delivery contract for an engagement must state "no untrusted roles within the tenant" as a precondition while this remains deferred.

Rationale: the bypass only matters under a threat model the pilot explicitly excludes; pulling planner changes into this pass would expand scope without serving the current engagement. Recording the trigger makes the deferral a decision, not an oversight. See project memory `pilot-trust-model-field-perm`.

## Considered Options

- **Role distinction** — (A, chosen) derive from existing `permissions`; (B) add a `Role.surface` column to decouple the boundary from permission contents — more explicit but a migration and a second source of truth for the same fact; (C) separate login entry points / apps — strongest isolation but the largest change to login/routing and contrary to the single-deployment model. B/C deferred; A is sufficient and reuses the resolver.
- **Enforcement depth** — (chosen) defense-in-depth across guard + skill assembly + data visibility + UI; (alt) skill+frontend only, leaning on same-tenant trust — rejected because it leaves design endpoints reachable by raw API call and would need redoing under narrowed trust; (alt) frontend-only — rejected as cosmetic.
- **Field perms** — (chosen) document & defer with a P0 trigger; (alt) fix the planner now — rejected for scope, as the bypass is out of the pilot's threat model; kept as the named follow-up.

## Consequences

- New permission constants + `isDesignTimeUser`/`designSurfaceFor` helpers in `@omaha/shared-types`; seed updated so the OPC's design-time grant is explicit (dedicated `opc` role or explicit grants on `admin`).
- New `RolesGuard` + `@RequiresPermission` decorator; design-time controllers annotated. 403s are audit-logged like existing query denials.
- The agent's skill assembly becomes per-request and permission-driven; `getScopedToolNames()` already narrows tools to the assembled skills, so a runtime agent is intrinsically query-only.
- Frontend gains role-aware nav/route gating in `(app)/layout.tsx`; no `middleware.ts` required (client guard + server guard suffice for the SPA).
- The field-level bypass remains open by design; the delivery contract carries the "no untrusted roles" precondition until the trigger fires, at which point the planner `allowedFields` work becomes P0.
- This unblocks #77: its acceptance item "role/auth model documented (decision recorded)" is satisfied by this ADR; #77 can move `ready-for-human` → `ready-for-agent` to implement the four enforcement layers above.
