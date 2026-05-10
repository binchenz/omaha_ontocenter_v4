---
status: accepted
---

# Per-objectType materialized views with synchronous refresh

Each ObjectType gets a materialized view that expands JSONB properties into real columns. The QueryPlanner targets these views instead of the raw `object_instances` table. Views are refreshed synchronously within the same transaction as the Apply layer's write (ADR-0019), guaranteeing read-after-write consistency.

This builds on ADR-0011's ObjectTypeIndex Registry concept — the registry now also manages view creation, column mapping, and refresh lifecycle.

## Why materialized views over alternatives

| Option | Rejected because |
|--------|-----------------|
| Table partitioning by objectTypeId | Doesn't solve the JSONB filter performance problem — queries still parse JSON within each partition. Cross-type joins degrade. |
| Async refresh (event-driven) | Agent users expect "I just imported data, now query it" to work immediately. Eventual consistency causes confusion in conversational UX. |
| Plain views (CREATE VIEW) | No performance benefit — still parses JSONB on every query. Defeats the purpose. |
| Expression indexes only | Index count explodes with objectType × property combinations. Requires manual management per tenant. |

## How it works

1. When an ObjectType is created or its schema changes, the ObjectTypeIndex Registry generates a `CREATE MATERIALIZED VIEW` with columns for each indexed property.
2. QueryPlanner compiles DSL filters into SQL targeting the materialized view (column-based WHERE) instead of JSONB operators.
3. After the Apply layer commits `ObjectEdit[]` to `object_instances`, it calls `REFRESH MATERIALIZED VIEW CONCURRENTLY` for affected objectTypes within the same transaction.
4. For bulk operations (ingest), refresh is deferred to end-of-batch rather than per-edit.

## Consequences

- Write latency increases by the refresh duration. At medium scale (<10M rows per objectType), `REFRESH CONCURRENTLY` completes in seconds. Acceptable for our write frequency (not high-throughput OLTP).
- Schema changes (adding/removing properties) require view recreation. The Registry handles this automatically.
- `CONCURRENTLY` requires a unique index on the view — the Registry must ensure one exists.
