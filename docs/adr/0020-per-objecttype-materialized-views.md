---
status: accepted
---

# Per-objectType materialized views with post-commit best-effort refresh

Each ObjectType gets a materialized view that expands JSONB properties into real columns. The QueryPlanner targets these views instead of the raw `object_instances` table. After the Apply layer commits `ObjectEdit[]` to `object_instances`, `REFRESH MATERIALIZED VIEW CONCURRENTLY` is invoked **post-commit, best-effort** — the refresh runs after the write transaction closes and its failure does not roll back the write.

This builds on ADR-0011's ObjectTypeIndex Registry concept — the registry now also manages view creation, column mapping, and refresh lifecycle.

## Why materialized views over alternatives

| Option | Rejected because |
|--------|-----------------|
| Table partitioning by objectTypeId | Doesn't solve the JSONB filter performance problem — queries still parse JSON within each partition. Cross-type joins degrade. |
| Async event-driven refresh (queue + worker) | Adds operational complexity (queue, worker, retries) we don't need at current scale. A post-commit synchronous call is simpler and gives the same UX in practice. |
| Plain views (CREATE VIEW) | No performance benefit — still parses JSONB on every query. Defeats the purpose. |
| Expression indexes only | Index count explodes with objectType × property combinations. Requires manual management per tenant. |
| Refresh inside the write transaction | `REFRESH MATERIALIZED VIEW CONCURRENTLY` cannot run inside a transaction block in PostgreSQL. Even if it could, coupling the write's success to the refresh's success trades a rare failure mode (refresh transiently fails) for a worse one (write appears to fail even though data is already in the source table). |

## How it works

1. When an ObjectType is created or its schema changes, the Registry generates a `CREATE MATERIALIZED VIEW` with columns for each filterable/sortable property.
2. QueryPlanner detects the view and aliases it as `object_instances` in the FROM clause so correlated subqueries from the DSL keep working.
3. `ApplyService.apply()` commits the `ObjectEdit[]` in a Prisma transaction. **After** the transaction closes, it calls `viewManager.refresh()` for each affected objectType.
4. If refresh fails, the error is logged with `tenantId` and `objectType`. The write is not rolled back — it has already committed.
5. The view will be brought back in sync by the next successful Apply against the same objectType (REFRESH MATERIALIZED VIEW CONCURRENTLY is idempotent).
6. For bulk operations (e.g. ingest), callers pass `batchMode: true` in ApplyContext to defer refresh to end-of-batch rather than per-edit.

## Consequences

- **Brief staleness window possible.** Between commit and refresh completion (or if refresh fails), queries through the view will miss the most recent writes. At medium scale (<10M rows per objectType), `REFRESH CONCURRENTLY` completes in seconds under normal load. Agent-facing UX is "write finishes → refresh triggered → query returns new data" in the same request cycle, not a separate eventual-consistency promise.
- **Refresh failure is best-effort observable, not a write failure.** Ops can grep logs for `view refresh failed` + `tenantId`. We deliberately do **not** build a retry queue or dead-letter store — `REFRESH CONCURRENTLY` being idempotent means the next successful Apply fixes it.
- **No staleness metadata in query responses.** If staleness investigation is ever needed, `pg_matviews` / `pg_stat_user_tables` already carry `last_refresh` timestamps per view. We don't replicate that in application state.
- Schema changes (adding/removing properties) require view recreation. The Registry handles this automatically.
- `REFRESH CONCURRENTLY` requires a unique index on the view — the Registry ensures one on `id`.

## Not guaranteed

- **Not** "synchronous refresh inside the write transaction."
- **Not** "write rolls back if refresh fails."
- **Not** strict read-after-write via the view in the 0.X% of cases where refresh fails.

These were earlier (wrong) claims in the first draft of this ADR. Corrected here.
