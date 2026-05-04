---
status: needs-triage
type: AFK
created: 2026-05-04
---

# 02 - Ontology flags + index-manager reconcile loop

## Parent

`.scratch/derived-property-engine/PRD.md`

## What to build

Extend the Ontology `PropertyDefinition` to carry `filterable: boolean`, `sortable: boolean`, `precision: int?`, `scale: int?`. Build an `index-manager` service with a single public method `reconcile(tenantId, objectTypeId)` that inspects `pg_indexes` for expression indexes over `object_instances.(properties->>'<field>')` scoped to `(tenant_id, object_type)`, then creates any missing indexes for newly-flagged properties and drops indexes for un-flagged properties. Call `reconcile` automatically after every Ontology save, and expose a manual `POST /ontology/object-types/:id/reconcile-indexes` endpoint returning the diff.

## Acceptance criteria

- [ ] `PropertyDefinition` DTO accepts and persists `filterable`, `sortable`, `precision`, `scale`; migration is additive
- [ ] `index-manager.reconcile` is idempotent: calling it twice in a row makes no further DDL changes
- [ ] Flagging a property `filterable: true` in the UI produces a visible expression index in `pg_indexes` after the save returns
- [ ] Un-flagging a property drops the corresponding expression index
- [ ] Manual `POST /ontology/object-types/:id/reconcile-indexes` returns `{ created: [...], dropped: [...] }`
- [ ] Integration tests against real Postgres assert `pg_indexes` state after sequences of declare / un-declare / re-declare
- [ ] Concurrent `reconcile` calls converge (no duplicate indexes, no orphans)

## Blocked by

None - can start immediately
