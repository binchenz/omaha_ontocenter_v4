---
status: done
shipped: 2026-05-04
commit: 4fd2d51
type: AFK
created: 2026-05-04
---

# 04 - DSL: exists clause, typed parameters, datetime support

## Parent

`.scratch/derived-property-engine/PRD.md`

## What to build

Extend the DSL grammar with `exists <rel> where <predicate>` and `not exists`, typed parameter declarations on derived properties (`datetime`, `decimal`, `string`, `int`, `boolean`), and parameter binding at query time. The compiler emits correlated subqueries against `object_instances` matched through the child's `relationships` JSONB. Extend the Ontology parser to validate that `<rel>` is a declared relationship on the Object Type.

Demo target: declare `Order.isPaidAt(cutoffTime: datetime) := exists payments where status = 'Success' and paidAt <= cutoffTime` and run the filter with a specific cutoff, returning only the orders paid by that time.

## Acceptance criteria

- [ ] Grammar accepts `exists <rel> where <pred>` and `not exists <rel> where <pred>`
- [ ] Derived properties accept a `params` list with typed entries; `compile` takes a param map and binds values into the SQL parameter list
- [ ] Ontology save rejects `exists` against an undeclared relationship on the Object Type
- [ ] Query Plan `filters[]` entry for a parameterized derived property carries a `params` block; missing params produce a clear error
- [ ] Compiled SQL is a correlated subquery against `object_instances` joined by `(tenant_id, object_type, relationships->>'<parent>'::text = parent.id::text)` and honors soft-delete filtering
- [ ] E2E: seeded orders + payments, declare `isPaidAt`, query with two cutoff values, assert disjoint result sets
- [ ] Table-driven DSL unit tests for exists / not exists / parameter arity / type mismatch / missing param at compile time

## Blocked by

- Issue 03 (DSL v1 skeleton)
