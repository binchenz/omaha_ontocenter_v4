---
status: done
shipped: 2026-05-04
commit: 3070412
type: AFK
created: 2026-05-04
---

# 07 - Query API: include[] + select[] projection via LATERAL

## Parent

`.scratch/derived-property-engine/PRD.md`

## What to build

Extend `POST /query/objects` to accept `include: string[]` (relationship names to return inline) and `select: string[]` (dot-paths to project). The planner assembles each include as a `LATERAL` subquery over `object_instances` joined via the parent's `relationships` JSONB; the response returns included relationships nested under a `relationships` key per row (shape unchanged from Plan 3). `select` trims the returned property bag to the listed paths; fields not listed but needed for permission / soft-delete filtering remain in the SQL but are not returned.

Demo target: one request with `include: ['customer', 'items', 'payments', 'latestReview']` returns all four in a single SQL round-trip, respecting field-level permission masking.

## Acceptance criteria

- [ ] `QueryObjectsRequest` DTO accepts `include: string[]` and `select: string[]`; empty arrays behave as "don't include / select everything"
- [ ] `include` entries that are not declared relationships are rejected with a clear error
- [ ] `select` dot-paths support cross-relationship paths (`customer.name`) once `include` lists the relationship
- [ ] Generated SQL is a single statement; no N+1 follow-ups
- [ ] Field-level permission masking still applies after projection
- [ ] Includes of derived relationships (`latestReview` from issue 05) work identically to declared relationships
- [ ] E2E covers a three-way include (`customer`, `payments`, `latestReview`) and asserts exact nested response shape

## Blocked by

- Issue 03 (DSL v1 skeleton)
