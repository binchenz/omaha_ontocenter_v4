---
status: needs-triage
type: AFK
created: 2026-05-04
---

# 05 - DSL: relation reduction + derived-property composition + cycle detection

## Parent

`.scratch/derived-property-engine/PRD.md`

## What to build

Add `maxBy <rel>.<field>`, `minBy <rel>.<field>`, `first <rel>`, `last <rel>` to the grammar. These return a single related Object Instance and can be used as a derived relationship — downstream derived properties can reference the reduced object's fields (`latestReview.rating`). Add same-Object-Type cross-references between derived properties. The Ontology validator must walk the dependency graph and reject cycles.

Demo target: declare `Order.latestReview := maxBy reviews.createdAt` and `Order.latestReviewIsPositive := latestReview.rating >= 4 or latestReview.sentiment = 'Positive'`; run a query filtering on `latestReviewIsPositive`.

## Acceptance criteria

- [ ] Grammar accepts `maxBy`, `minBy`, `first`, `last` and treats the result as a reference with 1-hop field access
- [ ] Derived property can reference another derived property on the same Object Type
- [ ] Ontology save detects and rejects cycles across derived properties with a clear error listing the cycle
- [ ] Compiled SQL uses `LATERAL` / `ORDER BY … LIMIT 1` against the child's relationships-joined rows
- [ ] Null case: when no related row exists, the derived relationship resolves to SQL NULL; downstream comparisons short-circuit cleanly (see ADR-0001 null propagation)
- [ ] E2E: seeded orders + multiple reviews with varied `createdAt` and `rating`; assert the latest review drives the filter
- [ ] DSL unit tests cover cycle detection across 2-hop and 3-hop dependency chains

## Blocked by

- Issue 04 (DSL exists + params)
