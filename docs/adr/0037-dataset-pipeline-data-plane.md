---
status: accepted
---

# Dataset/Pipeline data plane: a tenant-owned transform layer between Connector and Ontology

## Context

The platform has two of Palantir Foundry's three data legs — **Ontology reverse-inference** (ADR-0032, the "Ontology Manager" analogue) and **Accuracy Evals** (ADR-0033, the "AIP Evals" analogue) — but is missing the middle one: **Pipeline Builder**, the transform (T) layer. Today there is no place to clean data between a source and an Object Instance:

- The conversational data-ingestion path (ADR-0009) maps a source row straight to an Object Instance — no cleaning step.
- The only transform logic that exists is fused into hand-written `IngestRecipe.toInstance` code in `scripts/` (ADR-0016), engineer-authored, one-shot, re-done every engagement.
- `demo-drama` is the standing proof of the gap: its `mood`/`shotSize` fields landed as free-text dirt (16k rows / 329 distinct values), making categorical queries untestable (memory `demo-drama-seed-dirtiness`, ADR-0029 §Scope).

Two facts from the project owner (a 10-year data-engineering practitioner) reframe this from "nice to have" into a real product leg:

1. **The OPC is not a one-shot delivery.** Maintenance is a separately-billed, ongoing relationship. So the long-term value of lineage (trace a quality regression to its transform step; trace a source schema change to affected Object Types) does **not** evaporate at handoff — the OPC is still there to use it.
2. **Data cleaning costs 1–3 days per engagement.** This is a *major* work block, not occasional field normalisation. Turning it from hand-written scripts into reusable, declarative artifacts is a direct lever on ADR-0030's stated goal — maximise OPC throughput.

## Decision

Introduce a **Dataset/Pipeline data plane** as a first-class, tenant-owned layer between Connector and Ontology. This grows the missing Pipeline Builder leg, deliberately scoped to a single-operator product rather than Foundry's team-scale tool.

### The new shape

```
Source → [Connector] → Dataset(raw) → [Pipeline transforms] → Dataset(clean) → [Mapping + Sync Job] → object_instances → [Query Engine] → Agent
```

- **Connector** narrows to a pure ingestion adapter — it produces a raw **Dataset**, not Object Instances.
- **Dataset** is a tenant-owned, persistent, versioned snapshot of tabular data with a declared schema and a lineage record. Two kinds: **raw** (from a Connector) and **clean** (from a Pipeline step).
- **Pipeline** is a tenant-configured, declarative DAG of transform steps (normalise free-text, deduplicate, join, compute column) producing a clean Dataset, with **step-level lineage** so any clean-Dataset field traces back to its source column.
- **Mapping** binds an Object Type to a *clean Dataset* (not a Connector source table); **Sync Job** reads the clean Dataset and upserts Object Instances.

### Why a real Dataset plane, not a lighter "quality gate"

Three options were on the table (grilled explicitly):

- **(甲) Instance-time quality gate** — clean only on the `source row → object_instance` hop; no materialised intermediate, no lineage. Smallest build.
- **(乙) Lightweight multi-step transform** — declarative transform recipes, but output goes straight to instances; no first-class Dataset, no lineage.
- **(丙) Dataset/lineage plane** (chosen) — first-class, materialised, versioned Datasets + step lineage + Object Types bound to clean Datasets.

甲/乙 were rejected because the two owner facts above defeat the usual single-operator argument against 丙. The standard objection — "丙 is Foundry's heaviest component; an OPC who hands off and leaves can't maintain a DAG, so lineage value is zero at handoff" — does not hold when the OPC keeps maintaining the tenant and bills for it. And a 1–3 day cleaning cost per engagement is exactly the recurring tax that a reusable, materialised, traceable plane amortises, where 甲/乙 would force the cleaning logic to be re-derived or left un-inspectable.

### Reverse-inference stays on the raw source — the two legs are parallel, not stacked

The owner's field estimate: in a typical SMB source DB, **~50% of the core FK constraints are trustworthy, ~50% are missing/unreliable**. This is decisive for ordering. ADR-0032 grounds relationship *honesty* in real source FK constraints (FK ⇒ `metadata`; naming-guess ⇒ `heuristic`). If reverse-inference ran on a *clean* Dataset, those constraints would be gone (derived tables rarely carry FKs), collapsing every relationship to `heuristic` — destroying ADR-0032's honesty core.

Therefore the two legs run **in parallel off the same raw source**, not stacked:

```
raw source ──→ reverse-inference (reads FK) ──→ Ontology Draft   (honesty leg, ADR-0032 unchanged)
raw source ──→ Connector → Dataset → Pipeline → clean Dataset    (quality leg, this ADR)
                                                      ↑
                              Object Type (from leg 1) binds here via Mapping
```

The 50%-trustworthy figure makes this clean: leg 1 harvests the trustworthy-FK `metadata` relationships (real signal worth keeping); the untrustworthy 50% were `heuristic` anyway, so leg 2 "washing away" their FKs costs nothing. **ADR-0032 is not rewritten.**

### Seize the unimplemented-Sync-Job window

ADR-0006 (Sync Job) is still **Draft, not implemented**. Introducing the Dataset plane *now* lets Mapping's semantics be "Dataset → object_instances" from the first line of code. Waiting until Sync Job ships would make inserting the Dataset layer a breaking refactor of a live ingestion path. This is the cheapest moment in the project's life to make this change.

## Considered Options

- **(甲) instance-time quality gate / (乙) lightweight transform recipes** — rejected above; both forgo materialised Datasets and lineage, which the ongoing-maintenance + 1–3-day-cleaning facts make worth their cost. Either remains the fallback if 丙 proves too heavy in practice.
- **Reverse-inference on the clean Dataset** — rejected: destroys ADR-0032's FK-grounded honesty (the trustworthy 50% of relationships), the platform's stated "honesty not accuracy" standard.
- **Dataset as a "special Connector" (option B in grilling), Mapping unchanged** — rejected: minimal change, but makes Dataset a second-class concept bolted onto Connector, and misses the unimplemented-Sync-Job window to fix Mapping's semantics properly.
- **Defer 丙 behind ADR-0016's "second customer reuses recipes" trigger** — reconsidered and overridden: that trigger was set to avoid *speculative* platform investment. The cost is now demonstrated (1–3 days/engagement) and the maintenance model is confirmed ongoing, so the investment is no longer speculative.

## Consequences

- **New first-class concepts:** `Dataset` (raw/clean, versioned, lineage record) and `Pipeline` (transform-step DAG), both tenant-owned and persisted. New schema + migrations. New workbench surface (a Pipeline view — see ADR-0039).
- **Connector narrows** to an ingestion adapter; **Mapping** rebinds from source table to clean Dataset; **Sync Job** reads the clean Dataset. CONTEXT.md updated for all three plus the two new terms.
- **ADR-0006 is amended, not superseded:** its full/incremental/soft-delete semantics survive, but the Sync Job's *input* becomes a clean Dataset rather than a raw source table. The Dataset plane must be built before or with the Sync Job engine.
- **ADR-0032 unchanged:** reverse-inference keeps reading the raw source for FK honesty; it is the parallel honesty leg, not downstream of Pipeline.
- **ADR-0016 trigger overridden:** the "promote recipes to platform Mapping" trigger is consumed by this decision; `IngestRecipe` remains the `scripts/` one-shot tool, but the platform now has the materialised plane recipes were a stand-in for.
- **Transform edits are state-changing and follow the project's dry-run → confirm discipline** (ADR-0004 / ADR-0019 / ADR-0031): a transform step previews its effect on a Dataset sample (e.g. "329 distinct → 5 normalised values; 12 unmappable rows quarantined") before it is written to the Pipeline. Detailed in ADR-0039.
- **`allowedValues` enforcement gains an earlier home.** Today dirty values are caught only at Publish preflight (ADR-0031), after they are already in `object_instances`. With the Pipeline, normalisation/quarantine happens at the Dataset→instance hop; the preflight gate remains as defence-in-depth. The two gates' relationship is a follow-up to settle when the Pipeline transforms are specified.
- **Deferred:** the concrete transform-step catalogue (which transforms ship first), the Dataset storage/versioning mechanism (table-per-Dataset vs snapshot rows vs object store), and incremental Pipeline re-execution (recompute only affected steps on source change). This ADR fixes the *shape and the concepts*; the transform catalogue and storage are their own decisions.
