# 0028 — Keep the schema-summary projection; do NOT inject the full ontology into chat prompts

**Status: accepted.** Related: [0025](./0025-ontology-projection-for-llm.md) (the projection design this validates), [0026](./0026-enum-constrained-tool-parameters-axis-a.md) / [0027](./0027-cross-relationship-aggregation-spike.md) (same falsification discipline).

## Context

After a round of heavy ontology work (semantic annotations, derived properties, units, field descriptions, relationship cardinality, cross-relationship aggregation), a pre-launch question was raised: since the ontology now carries much more than before, should the chat system prompt inject the **full ontology** instead of the compact **schema summary** (`getSchemaSummary`)?

This rests on a false premise worth correcting: there is no separate "schema" and "ontology". `getSchema()` *is* the ontology (`listObjectTypes` + `listRelationships`); `getSchemaSummary()` is a token-bounded **projection** of that same ontology. The real question is: does the projection drop ontology information that the LLM actually needs in chat?

The projection demonstrably drops: derived properties (entirely), relationship cardinality (`one-to-many` etc.), **all properties that are neither filterable nor sortable** (`.filter(p => p.filterable || p.sortable)`), and field descriptions beyond 50 chars. But the full ontology stays reachable at runtime via the `get_ontology_schema` tool, which returns `getSchema()` verbatim.

## Decision

**Keep the two-layer design — compact projection in the prompt + `get_ontology_schema` escape hatch — and do not inject the full ontology.** A pre-launch falsification probe showed the dropped fields do not cause a behavioral defect; full injection would spend the prompt budget the projection exists to protect, to supply information the LLM already fetches on demand.

## Evidence (live DeepSeek, judgement X: does the model deny real data exists?)

Probed the cleanest reachable gap on the demo-drama tenant — **non-filterable fields** `subtitle` / `narration` / `action`, which are absent from the injected summary but present in the ontology and populated with real content. 3 scenarios × 3 runs:

| Probe | Field | Hallucinated denials | Field in injected summary | Called get_ontology_schema |
|---|---|---|---|---|
| P1 | subtitle | 0/3 | 0/3 | 2/3 |
| P2 | narration | 0/3 | 0/3 | 3/3 |
| P3 | action | 0/3 | 0/3 | 3/3 |

`summaryHadField=0` confirms the gap was real on every run; **zero denials across 9 runs**. The model coped by calling `get_ontology_schema` to recover the full ontology. Strongest single data point — P2 said verbatim: *"由于 `narration` 字段不是 filterable，我需要在全部数据中扫描…"* — it knew the field existed **and** that it was not filterable, neither of which is in the injected summary. The projection + escape hatch together make the ontology fully perceivable.

## Consequences

- Full injection is rejected as a negative trade: it pays per-token, per-turn for derived properties / all fields / cardinality / untruncated descriptions, and would breach the prompt budget (warn 4000 / error 5000) once the ontology grows past the `maxTypes=15` projection cap. The cap already routes large ontologies to `get_ontology_schema`.
- This converts PR #65's *deferral* of full injection from a bet into an evidence-backed decision.
- **Untested corner:** derived properties (A1) could not be probed — demo-drama has none. If a derived-property-heavy tenant goes live, re-run an equivalent judgement-X probe before assuming this conclusion covers that case.
