# ObjectTypeIndex Registry: Authoritative Ownership of Per-Tenant Indexes

The platform owns a set of Postgres indexes on `object_instances`, one per `(tenant, object type, filterable/sortable property)` combination. Today that set is reconstructed at read time by querying `pg_indexes` and matching a string convention. We replace this with an explicit `ObjectTypeIndex` registry table that is the authoritative record of what indexes the system owns; `pg_indexes` becomes an implementation detail of *applying* the desired set to Postgres.

## Why

Two real bugs and one architectural smell in the same module forced this:

1. The substring-matching pattern `LIKE 'idx_oi_${slug}_%${typeName.slice(0,20)}%'` causes within-tenant collisions today: a tenant with object types `order` and `order_history` will, on the next `reconcile(order)` after marking a property non-indexable, drop indexes belonging to `order_history`. This is a corruption-class bug at current scale, not a future-scale concern.
2. The 8-hex-char tenant slug (`tenantId.replace(/-/g,'').slice(0,8)`) collides at roughly 65k tenants by birthday-paradox math. When two tenants share a slug, one's `reconcile()` will see and manipulate the other's indexes. Latent until scale.
3. `OntologyService.deleteObjectType` does not reconcile indexes (F11). Indexes are leaked. The fix is structural — FK-cascade from a registry table — not procedural.

The shared root cause is that the system has no first-class concept of "index ownership." It infers ownership from a string convention applied to `pg_indexes`. Substring matching is brittle, the slug is too short, and there is no place for delete cascade to attach to.

## Considered Options

**JSON column on `object_types` (`existing_indexes JSONB`).** Atomic with object_type writes; no migration adds a table. Rejected because it loses queryability (`SELECT … WHERE field='x'` becomes JSON-ops), loses FK cascade (the F11 fix), and conflates configuration (`properties[].filterable`) with state (does the index exist) on the same row. The migration cost it avoids is trivial in this codebase.

**Hash-only naming fix (full UUID + sha hash).** Rename indexes to `idx_oi_<sha1(tenantId||typeId||field||kind)[:48]>` and use the full hash for lookup. Eliminates string collisions without a new table. Rejected because the architectural smell is not "the names are too short" — it is "we don't own the state." `pg_indexes` remains the source of truth for ownership; a manual `DROP INDEX`, a partial reconcile that crashed mid-loop, or a future migration tweaking naming silently desyncs us. Hashing fixes a symptom without fixing the seam.

**Lifecycle API (`onObjectTypeCreated/Updated/Deleted`).** Drop `reconcile()` as the primary entry; expose lifecycle hooks. Rejected for now — current call sites in `OntologyService` already look like lifecycle hooks (create→reconcile, update→reconcile). Renaming them now is churn without leverage. The registry shape allows this evolution later without a second migration.

**`SELECT FOR UPDATE` on registry rows for concurrency.** Considered for the race between two simultaneous reconciles of the same type. Rejected because (a) `CREATE INDEX` cannot safely run inside a transaction holding other locks, and (b) first-time reconcile has nothing to lock against. Replaced by transaction-scoped `pg_advisory_xact_lock` keyed on `(tenantId, objectTypeId)`.

**Optimistic version column on `object_types`.** Textbook concurrency control: bump version on every update, reject stale writes, retry. Rejected because workload is "an admin edits ontology occasionally"; pessimistic advisory lock is one line and pays the same correctness for a fraction of the implementation cost.

**`CREATE INDEX CONCURRENTLY` for zero-downtime adds.** Concurrent index creation cannot run inside a transaction, which would force the apply step out of the advisory-lock-holding transaction. Deferred — current `object_instances` table size doesn't warrant it. When it does, the registry shape supports the split (lock → diff → commit → CONCURRENTLY apply → separate registry-update transaction); only the `IndexManagerService` internals change.

## Consequences

- **A new Prisma model `ObjectTypeIndex` is added** — a row per `(tenantId, objectTypeId, field, kind, indexName)` with a unique constraint on `(tenantId, objectTypeId, field, kind)` and an FK to `object_types(id) ON DELETE CASCADE`.
- **`IndexManagerService.reconcile()` keeps its public signature.** Internals shift from `pg_indexes` substring matching to: read desired from ontology, read existing from registry, diff, apply DDL, update registry. Caller changes are zero.
- **A new method `IndexManagerService.dropAllFor(tenantId, objectTypeId)` is added** and called from `OntologyService.deleteObjectType` before the type row is deleted. F11 is fixed structurally — even if the explicit call is forgotten, the FK cascade removes the registry rows when the type is deleted, leaving orphaned Postgres indexes that subsequent reconciles can detect and clean up.
- **Index naming for newly-created indexes includes the full `object_type_id`** (a UUID) rather than the first-20-chars-of-name. The name is generated from the `object_type_id` so it is unambiguous and stable across renames. Old-style names continue to be recognized during the one-time adoption step.
- **Concurrency is transaction-scoped advisory lock.** Two concurrent reconciles for the same `(tenant, type)` serialize. Two reconciles for different tenants or different types in the same tenant proceed in parallel.
- **Migration is self-healing on first reconcile, not at deploy time.** When `reconcile(tenant, type)` finds the registry empty for that pair, it queries `pg_indexes` once for indexes matching that exact `(tenant, type)` pattern (old or new style), inserts adoption rows, then proceeds with the normal diff. Adoption fires once per `(tenant, type)` and is idempotent on retry. There is no SQL backfill in the Prisma migration itself.
- **The one-time adoption inherits the old buggy substring scope** for the indexes it pulls in. This is acceptable because (a) adopted rows are immediately diffed against the desired set for *that* tenant+type, so any wrongly-attributed index either gets kept (if it happens to match a desired property) or dropped (the same outcome as today), and (b) all reconciles after adoption use the unambiguous registry. The window of buggy behavior shrinks from "every reconcile, forever" to "the first reconcile per type after deploy."
- **`pg_indexes` becomes an implementation detail of the apply step.** It is read once during adoption and once per reconcile (only to confirm `IF EXISTS`-class semantics on DROP). It is no longer the source of truth for ownership.
- **The unsafe-identifier guard (`SAFE_IDENT.test(p.name)`) stays.** The registry stores property names, but Postgres index DDL still interpolates them into raw SQL. F16 remains its own concern.
- **`CONTEXT.md` does not get a new entry.** `ObjectTypeIndex` is a code-internal concept. Domain experts reason about `filterable` / `sortable` on `PropertyDefinition`; whether those flags translate to one B-tree index, two indexes, a GIN index, or none at all is below the abstraction level the glossary serves.
- **Test surface improves.** Cycle tests previously hand-dropped orphaned indexes in a `finally` block; that workaround can be removed. `IndexManagerService` gains a real unit-testable interface (the registry) where collision and concurrency scenarios become assertable, replacing the e2e-only coverage that exists today.
- **F2 (cross-tenant slug collision) and F3 (within-tenant substring collision) are eliminated by construction**, not by patching the slug or the LIKE pattern. The seam shape — "we own a registry, Postgres applies it" — makes both classes of bug structurally impossible going forward.
