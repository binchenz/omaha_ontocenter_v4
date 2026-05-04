---
status: done
shipped: 2026-05-04
commit: cd8be1a
type: AFK
created: 2026-05-04
---

# 08 - Filterable / sortable enforcement + derived-property pre-flight validation endpoint

## Parent

`.scratch/derived-property-engine/PRD.md`

## What to build

The query-planner rejects `filters[]` entries targeting a property that is not flagged `filterable`, with an error message that names the property and suggests the admin action to take. A `sort` on a property not flagged `sortable` falls back to the default sort order (the planner logs a warning and the response `meta` carries a `sortFallbackReason`). Expose a new `POST /ontology/object-types/:id/derived-properties/validate` endpoint that takes `{ expression: string, params?: [...] }` and returns `{ valid, dependencies: [...], complexity, errors: [...] }` so admin UIs can pre-flight an expression before save.

## Acceptance criteria

- [ ] Planner rejects a filter on an unflagged property with a structured error: `{ code: 'PROPERTY_NOT_FILTERABLE', property, objectType, hint }`
- [ ] Planner ignores a `sort` on an unflagged property; response `meta.sortFallbackReason` is populated
- [ ] Pre-flight endpoint returns `valid: false` with a list of diagnostics for each syntactic or semantic error; does not mutate Ontology state
- [ ] Pre-flight returns `dependencies: string[]` (property / relationship / sibling derived-property names) when valid
- [ ] Pre-flight returns a deterministic numeric `complexity` score
- [ ] E2E: unflagged filter → 400 with the expected code; unflagged sort → 200 with `sortFallbackReason`
- [ ] Pre-flight endpoint has its own E2E test covering valid / invalid / ambiguous expressions

## Blocked by

- Issue 02 (Ontology flags + index-manager)
- Issue 03 (DSL v1 skeleton)
