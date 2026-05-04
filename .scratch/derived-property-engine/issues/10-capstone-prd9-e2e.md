---
status: done
shipped: 2026-05-04
commit: 0c3fdac
type: AFK
created: 2026-05-04
---

# 10 - Capstone: PRD §9 reference query end-to-end

## Parent

`.scratch/derived-property-engine/PRD.md`

## What to build

Assemble a single end-to-end test that runs the flagship PRD §9 query — "yesterday before 19:00 in Hangzhou, paid by 11am today, latest review positive, details" — as a hand-written Query Plan through `POST /query/objects`. The test seeds a realistic demo tenant (orders across cities and hours, payments with varied statuses and timestamps, reviews with varied ratings), declares the three derived properties (`isPaidAt`, `latestReview`, `latestReviewIsPositive`), declares the filterable / sortable flags for `fulfillmentCity` and `createdAt`, configures a customer-service permission, and asserts the exact returned order ids. Verify that the `meta` of the response carries `compiledSqlHash` and that `audit_logs` for this request contains `effective_permission_filter` and `compiled_sql_hash`. Run the same query with a different `cutoffTime` and assert a different result set. Run the same query under a restrictive permission scope and assert rows are filtered out.

This slice does not add capability — it proves the previous nine slices compose. Expect only glue, demo seed data, and test assertions.

## Acceptance criteria

- [ ] Demo seed script produces ≥ 20 orders with realistic varied properties; at least 3 match the §9 filter, at least 5 fail it for each distinct reason
- [ ] Reference query runs as a single `POST /query/objects` and returns the expected ids in the expected order
- [ ] `meta.compiledSqlHash` is present and stable across runs with the same plan
- [ ] `audit_logs` row for the request contains populated `effective_permission_filter` and `compiled_sql_hash`
- [ ] Same query with a different `cutoffTime` returns a different set; assertion is on both sets
- [ ] Same query under a restrictive permission (region-scoped or owner-scoped) returns a reduced subset
- [ ] Same query with one Payment soft-deleted (issue 01) returns a reduced subset
- [ ] All three assertions run inside one E2E file so regressions surface together

## Blocked by

- Issue 04 (DSL exists + params)
- Issue 05 (DSL maxBy + composition)
- Issue 06 (DSL aggregates + arithmetic)
- Issue 07 (include + select)
- Issue 09 (permission DSL + audit)
