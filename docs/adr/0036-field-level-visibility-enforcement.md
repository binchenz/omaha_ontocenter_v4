---
status: accepted
supersedes: ADR-0035 §3 (field-level permission bypass: document & defer)
---

# Field-level visibility enforcement: visible-view projection + single output materializer

## Context

ADR-0035 §3 recorded a known field-level permission bypass and **deferred** the fix behind a P0 trigger ("the instant a runtime role not fully trusted with all field values is introduced"). The resolver produced `allowedFields` (the principal's visible base-field set; `null` = all), but it was enforced at only **one** of the places it was needed:

- **Output**, parent rows only: `filterMaskedFields` masked the returned `properties` (`query.service.ts:144`).
- **Not** at any input site: a user-supplied field name reaching SQL via `filter` / `sort` / `groupBy` / aggregate `metric` was gated only by the `OntologyView` capability sets (`filterableFields` / `sortableFields` / `numericFields`), never by visibility. So a masked field's values leaked through `WHERE salary > $1` (binary-search the row count), `groupBy salaryBand` (distinct masked values as group keys), or `sum(salary)` (aggregate value).
- **Not** on included children at all: `fetchIncludes` pushed child `properties` raw and resolved **no** permission for the child Object Type — so included children bypassed both field masking *and* row-level **Predicates**. (This row-level leak was outside ADR-0035 §3's field-level scope — it was never covered by the deferral.)

A `/improve-codebase-architecture` review reframed this as a **depth** problem: field visibility was a primitive (`Set<string> | null`) that a read path could silently forget, which is exactly why 4 of 5 sites forgot it. The decision here is to make visibility enforcement structural, and — at the project owner's direction — to **enforce now** rather than continue deferring.

## Decision

Enforce field-level visibility at the **query seam** through two concentrated modules plus the include-path fix. No `FieldMask` value type.

### 1. Input seam — a visible-view projection the existing gates already trust

The four input gates already gate on one value: the `OntologyView`'s capability sets. So narrow that value rather than add a check at each site.

- `projectVisible(view, allowedFields)` (`packages/dsl/src/visible-view.ts`, pure) returns a **non-mutating** copy of the view with `numericFields` / `booleanFields` / `stringFields` / `filterableFields` / `sortableFields` and `derivedProperties` narrowed to the visible set. `allowedFields = null` returns the view by reference (⊤ is free).
- A **Derived Property** is visible iff every base field in its transitive dependency closure is visible (`visibleClosure`, via `analyze(expr).dependencies`, memoized + cycle-guarded; relation dependencies are pass-through). A masked-base derived property is pruned, so a derived filter on it hits the existing "Unknown derived property" path.
- The planner applies `projectVisible(rawView, args.allowedFields)` at each `load()` site (`plan`, `planAggregate`, and both views in `planCrossRelAggregate`). The four gate implementations are **unchanged**; a masked field is absent from the narrowed sets and rejected with the *same* error as a non-capable / absent field — **no existence oracle**.

### 2. Output seam — one materializer that seals mask-before-select

- `toInstanceDto(properties, allowedFields, select?)` (`apps/core-api/src/common/to-instance-dto.ts`) is the single row→DTO path. It masks first, then applies `select`, so `select` can never surface a masked field. It absorbs and replaces `filterMaskedFields` (deleted). Both the parent path and the included-children path route through it, so no materialization can forget masking.

### 3. Include path — resolve the child type's visibility *and* predicates together

- `fetchIncludes` now resolves the **child** Object Type's permission (`PermissionResolver.resolve`, non-throwing). On denial the relation is omitted (empty). On grant it applies the child's row-level `predicates` (previously missing — a real leak) and materializes children through `toInstanceDto` with the child's `allowedFields`. The two travel together because they come from one resolution.

### 4. Thread `PermissionResolution`, not a new value type

`allowedFields` and `predicates` are passed on `PlanArgs` / `AggregatePlanArgs` exactly as predicates already were. The cohesive bundle the work needs (`{ allowed, allowedFields, predicates }`) already exists as `PermissionResolution`; minting a `FieldMask` class would not survive the deletion test inside this seam — `projectVisible` + the existing resolution cover every consumer, and each consumer already holds a view or a resolution. (A value type would earn its keep only at a layer carrying neither — the LLM schema projection — which is explicitly out of scope; see Consequences.)

## Considered Options

- **Standalone `FieldMask` value type crossing both seams** (the minimal-interface design): elegant and self-documenting, but inside the query seam every consumer already holds a view or a `PermissionResolution`, so the wrapper adds ceremony without surviving its own deletion test. Rejected here; revisit if/when the LLM schema-projection layer is gated.
- **Explicit `gate.assertVisible(field)` at each input site** (the explicit-collaborator design): makes enforcement visible at the call site, but doubles the gate code and pushes the forget-risk *up* to every caller — the opposite of the depth goal. The input gates are already a single-value seam; narrowing that value is strictly more forget-resistant. Rejected.
- **Fold visibility into `OntologyViewLoader.load()` itself**: rejected. The loader is `@Injectable({scope: REQUEST})` and caches per `tenantId::objectType` with **no principal in the key**; a narrowed `load()` would poison the shared cache. More importantly, the resolver loads the same view to compile permission **Predicates**, and OPC conditions legitimately reference fields the end user cannot see (`salaryBand = :tier`) — narrowing the type-system sets would break predicate compilation. Visibility must be a separate, non-mutating projection layered at the consumer, where the principal is known; Predicates carry their own full view (`emit` reads `predicate.view`) and are never touched.
- **Continue ADR-0035 §3's defer**: rejected by the project owner — enforce now.

## Consequences

- The field-level bypass named in ADR-0035 §3 is **closed**, ahead of its P0 trigger. The delivery-contract precondition "no untrusted roles within the tenant" is no longer load-bearing for field values (it may still matter for other reasons).
- New: `projectVisible` / `visibleClosure` in `@omaha/dsl`; `toInstanceDto` in core-api (replaces `filter-masked-fields.ts`); `OntologyView.visibilityRestricted` flag. Modified: `PermissionResolution`-fed `allowedFields` threaded on `PlanArgs`/`AggregatePlanArgs`; `fetchIncludes(user, …)`.
- **Leniency-hole closed.** The gates' "uncurated type (no filterable fields) ⇒ allow all" affordance would, under pure intersection, re-open the leak for a principal whose visible fields are disjoint from the filterable set (narrowed set empty ⇒ leniency fires). `projectVisible` marks the view `visibilityRestricted`, and the three guards treat a restricted view as an exact whitelist. Regression-tested.
- **`countDistinct` now gated.** It previously had no field check at all; `countDistinct` over a masked field leaked the field's cardinality. A visibility gate now covers every field-bearing metric.
- **Cross-relationship aggregation** gates the related group-key field against the *other* type's visibility — an extra `resolve` on the related type in `query.service`, in scope here.
- ⊤ (admin / single-trusted-tenant, the common case) is unchanged at runtime: `null` allowedFields ⇒ same-reference view, identity output, `visibilityRestricted` undefined.
- **Deferred (separable):** a distinct `field-not-visible` **audit reason**. The codebase has no audit-on-rejection path today (only successful queries are audited); the user-facing requirement (same error, no oracle) is fully met by structural absence from the narrowed view. Adding rejection-time audit is a separate security-logging decision (it should cover *all* rejection reasons, not just visibility, and weigh probing/log-spam). **Also deferred:** gating the LLM schema projection (ADR-0025/0028) so the runtime agent never *sees* masked field names — a weaker, name-level oracle; field *values* (the P0) are already closed.
- Tests: `visible-view.spec.ts` (closure + projection, incl. transitive derived + relation pass-through + ⊤ identity + non-mutation), `to-instance-dto.spec.ts` (mask-before-select), `query-planner-visibility.spec.ts` (filter/groupBy/numeric/countDistinct rejection + leniency-hole regression). All green; no regression in the existing suite.
