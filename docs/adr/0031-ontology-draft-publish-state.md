---
status: accepted
---

# Lightweight Ontology Draft/Publish state via an independent draft-snapshot table

## Context

The OPC design-time accelerators (ADR-0030: reverse-inference, accuracy Evals, template library) all operate on a whole-ontology unit, not single-field edits: reverse-inference produces an entire ontology, templates instantiate an entire ontology, and rollback discards an entire set of changes. Today `ObjectType` has only a `version Int` optimistic-lock counter — no draft/published distinction — so every ontology edit takes effect in place and is immediately visible to the runtime querying Agent. There is no safe space to build up and validate changes before exposing them to SMB end users.

We need exactly two states per Tenant: the live **published** Ontology that the runtime Agent reads, and at most one mutable **Draft**. Discarding the Draft is the rollback. We explicitly do **not** want multi-branch or full immutable version history (that trade-off was considered and rejected as too heavy for a single-pilot OPC tool).

## Decision

Store the Draft as a single row per Tenant in a new `ontology_drafts` table holding a **JSON snapshot of the entire ontology** (all object types, their properties/derived properties/semantic annotations, and all relationships). The live production tables (`object_types`, `object_relationships`) are unchanged and remain the sole source for all runtime read paths.

- **Runtime read paths are untouched** — query compilation, schema projection for the LLM, indexing, and data import all keep reading `object_types`/`object_relationships`. Zero runtime regression risk.
- **Design-time operations work on the snapshot** — reverse-inference writes a snapshot, template instantiation overwrites/merges it, editing mutates it, discard deletes the row. Increasing or deleting types and rewiring relationships are all just JSON edits, with no table-constraint friction.
- **Publish is atomic** — one transaction diffs the snapshot against the live tables and applies inserts/updates/deletes, then clears the draft row.

The cost is a dual representation (production = normalized rows, draft = JSON snapshot), requiring a **flattener** (snapshot → rows) and a **snapshotter** (rows → snapshot) kept structurally in sync. This cost is not additional: reverse-inference and templates already produce ontologies in snapshot form, so the snapshot is the shared data structure for all three accelerators, fixed early.

## Considered Options

- **A — Inline draft columns on `ObjectType`** (`draftProperties` etc.): zero runtime regression, but cannot express structural drafts (adding/deleting a whole type) and has nowhere to hold relationship drafts. Degenerates into option B as soon as reverse-inference/templates rebuild the whole ontology. Rejected.
- **B — Shadow rows with a `stage` column**: expresses structural drafts naturally, but every one of the 9+ ObjectType/Relationship read sites must add a `stage='published'` filter — miss one and runtime queries are polluted by unpublished changes. Largest intrusion, highest risk. Rejected.
- **C — Independent draft-snapshot table** (chosen): zero runtime regression + most natural fit for whole-ontology operations + atomic publish, at the cost of a flattener/snapshotter pair that is needed anyway.

## Consequences

- A snapshot JSON schema must be defined and versioned alongside the ontology types in `@omaha/shared-types`, shared by reverse-inference output and template definitions.
- Design-time reads (workbench showing the draft) go through the snapshot, not the existing OntologyService.

## Publish preflight (data-impact gate)

Publish only mutates schema definitions — it never touches `object_instances`. But because the OPC's real workflow is iterative (load data → run Evals → find a wrong field → edit the draft schema → republish), a published type may already have instances when its schema changes in the draft. Rather than migrate data (risky, possibly irreversible) or silently let schema and data diverge, Publish runs a **preflight** that diffs the draft snapshot against the live ontology *and* the existing instances, classifies each change, and — for breaking changes — surfaces the impact for explicit OPC confirmation before applying. This reuses the project's existing dry-run → confirm → execute pattern (ADR-0004 Action Preview, ADR-0019 declarative edits, `ApplyService`), lifted to ontology scope.

Two tiers (no separate hard-block tier — the OPC is the trusted single-tenant operator, so anything whose impact can be computed is theirs to decide):

- **Safe** (auto-pass, no prompt): add field, add object type, add relationship; edit label/description/unit; toggle filterable/sortable (index-only, data-untouched).
- **Breaking** (compute affected instance count, require explicit confirmation): drop field (orphans the JSONB key on N instances), change field type (N instances' stored values may be unreadable / break aggregation), drop object type (N instances become unqueryable), drop relationship (child `relationships` pointers orphaned), **tighten/add allowedValues** (preflight scans existing instances and counts how many violate the new constraint — consistent with the import-time whole-batch-reject gate: runtime can't admit dirty values, and publish must surface pre-existing dirty values).

Publish does not auto-fix data; it informs and gates. What to do about flagged data (clean it, leave it, migrate it) is a follow-up the OPC decides, out of scope here.

## Consequences (additional)
