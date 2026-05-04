---
status: done
shipped: 2026-05-04
commit: 4fb261a
type: AFK
created: 2026-05-04
---

# 06 - DSL: aggregates + arithmetic + decimal precision

## Parent

`.scratch/derived-property-engine/PRD.md`

## What to build

Extend the grammar with `count <rel>`, numeric aggregates `sum`/`avg`/`min`/`max` over `<rel>.<field>`, and binary arithmetic (`+`, `-`, `*`, `/`). Implement the `precision` / `scale` decimal-casting rule: any property used in arithmetic or a numeric aggregate must declare `precision` and `scale` in the Ontology; the compiler reads those and emits `((properties->>'field')::decimal(p, s))`. Null propagation follows ADR-0001 (coalesce to type zero in aggregates).

Demo target: declare `Order.isFullyPaid := sum(payments.amount) >= totalAmount` on orders that declare `totalAmount` with `precision: 12, scale: 2` and payments that declare `amount` similarly; run the filter.

## Acceptance criteria

- [ ] Grammar accepts aggregate forms and binary arithmetic with standard precedence
- [ ] Compiler rejects arithmetic on a decimal property missing `precision` / `scale` at save time
- [ ] Aggregates coalesce missing / deleted-child cases to type zero in SQL
- [ ] `count <rel>` emits `COUNT(*)` over the joined child subquery, not `COUNT(field)`
- [ ] Division-by-zero produces a null result, not a 500
- [ ] E2E: seeded multi-payment orders (fully paid, partial, overpaid); assert the filter classifies them correctly
- [ ] DSL unit tests for every aggregate, precedence edge cases, null / zero propagation

## Blocked by

- Issue 03 (DSL v1 skeleton)
