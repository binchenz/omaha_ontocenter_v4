---
status: accepted
---

# Declarative ObjectEdit model for Actions

ActionHandlers return `ObjectEdit[]` instead of imperatively writing to the database. The platform's Apply layer validates edits against the ontology schema, checks permissions, and commits them atomically in a single transaction. This extends ADR-0004's preview/dry-run concept into the write path.

```typescript
type ObjectEdit =
  | { op: 'create'; objectType: string; properties: Record<string, unknown> }
  | { op: 'update'; objectId: string; properties: Record<string, unknown> }
  | { op: 'delete'; objectId: string }
  | { op: 'link'; from: string; to: string; linkType: string }
  | { op: 'unlink'; from: string; to: string; linkType: string }
```

`update` uses **full replacement** semantics: the `properties` object is the complete new state, not a partial patch. This eliminates ambiguity between "field not provided" and "field explicitly cleared".

## Why declarative over imperative

- **Testability**: handler tests assert on returned edits without needing a real database.
- **Auditability**: every action produces a structured changeset that can be logged, diffed, and replayed.
- **Validation before write**: schema conformance and permission checks happen before any mutation, preventing partial-write states.
- **Preview for free**: ActionPlan (ADR-0004) becomes the same `ObjectEdit[]` rendered as a dry-run — no separate preview code path.

## Why full replacement over partial patch

Partial patch requires distinguishing "not provided" from "set to null". In TypeScript, `undefined` vs `null` is fragile across serialization boundaries (JSON drops `undefined` keys). Full replacement is unambiguous: what you send is what gets stored. The cost (sending unchanged fields) is negligible for our object sizes.

## Considered options

- **Imperative handlers with transaction wrapper**: simpler to implement but loses testability and auditability benefits. Handlers become coupled to Prisma internals.
- **Event-sourced write model**: maximum auditability but massive complexity increase (event store, projections, eventual consistency). Overkill for current scale.

## Consequences

- Existing tools return `Promise<unknown>` from imperative SDK calls. Migration to `ObjectEdit[]` can be done incrementally — a compatibility shim can wrap old-style tools during transition. ADR-0004's Action schema (ActionDefinition, ActionPreview, ActionRun) exists in the database but has no service implementation yet, making this a good time to define the pattern correctly.
- Apply layer becomes a critical path component; must be well-tested and handle edge cases (circular links, self-referential updates).
- Materialized view refresh (ADR-0020) hooks into the Apply layer's post-commit step.
