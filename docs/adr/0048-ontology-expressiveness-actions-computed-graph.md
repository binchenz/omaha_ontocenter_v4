# ADR-0048: Ontology Expressiveness — Actions, Computed Properties, Visual Graph

**Status:** Accepted  
**Date:** 2026-06-07  
**Deciders:** binchenz  

## Context

Gap analysis against Palantir Foundry identified three missing ontology capabilities:
1. **Actions** — typed write operations bound to ObjectTypes (Foundry's core differentiator)
2. **Computed Properties** — derived fields expressed as DSL formulas
3. **Visual Graph** — ontology structure visualization

The project already has partial infrastructure: `ApplyService` (transactional Object graph mutations), `ActionDefinition`/`ActionPreview`/`ActionRun` Prisma models (schema-only, unused), `packages/dsl` (arithmetic, aggregates, cross-relation references), and `OntologyView.derivedProperties` data structure.

## Decisions

### D1: Actions — Declarative, not Agent-inferred

**Chosen:** Actions are first-class ontology citizens. An `ActionDefinition` binds to an ObjectType with typed parameters, a DSL precondition, and declarative effects (set_field, create/delete_relationship, create_object).

**Rejected:** Agent-inferred writes (Agent decides at runtime what to mutate based on user intent). Rejected because:
- No safety boundary — "标记所有订单为完成" could be catastrophic
- No discoverability — Agent can't tell users "these operations are available"
- No structured preview in confirmation UX

### D2: Actions — Object graph scope, single-target execution

**Chosen:** Effects limited to ontology-internal operations (field writes + relationship mutations + object creation). All within a single Prisma transaction. First version is single-object trigger only (pass one objectId).

**Rejected alternatives:**
- External API calls in effects (requires retry/timeout/credential infrastructure — different system)
- Batch execution by filter expression (risk of catastrophic writes; deferred to v2 with explicit batch-confirm UX)

### D3: Actions — Agent-first definition and triggering

**Chosen:** Phase 1 is Agent-only: `create_action` tool defines Actions, `execute_action` tool triggers them. The execution flow: query_objects → find target → execute_action → precondition check → preview → confirmation_request → apply.

**Deferred:** UI-based Action definition editor and query-result-row Action buttons (Phase 2).

### D4: Computed Properties — Agent writes DSL, no visual formula editor

**Chosen:** Agent writes DSL expressions into `derivedProperties` via `update_object_type`. UI shows computed fields read-only with optional text editing for OPC power users.

**Rejected:** Template selector UI and visual formula builder. The DSL syntax is already concise (`sum orders.quantity`), and Agent-as-editor matches the project's interaction paradigm. Investment goes to validation feedback (parse errors, unknown relations) rather than visual composition.

### D5: Visual Graph — Read-only interactive, not full-edit

**Chosen:** React Flow graph showing ObjectType nodes + Relationship edges. Click node to expand detail panel. Draggable layout for readability.

**Rejected:** Full-edit graph (drag-to-create nodes/edges). Editing already has two working entry points (Agent + form UI). The graph's value is comprehension of global structure, not a third editing surface. Full-edit ROI doesn't justify the engineering cost (optimistic updates, conflict handling, undo).

### D6: Action execution reuses ApplyService

**Chosen:** `ActionExecutor` interprets declarative effects into `ObjectEdit[]` and delegates to the existing `ApplyService.apply()`. This gives us transactions, soft-delete, materialized view refresh, and dry-run preview for free.

**Rejected:** Separate execution engine. ApplyService already does exactly what Action effects need — no reason to duplicate.

## Consequences

- `ActionDefinition` Prisma model gains an `effects` JSON column (array of effect descriptors)
- `get_ontology_schema` output grows to include available Actions per ObjectType
- `ontology-design.skill.ts` prompt expanded with Action creation rules and Computed Property DSL rules
- `update_object_type` tool schema extended with `derivedProperties` parameter
- New dependency: `reactflow` in apps/web
- No new DSL syntax required — existing expression language covers all Computed Property needs except time functions (deferred: use parameter binding for now)
