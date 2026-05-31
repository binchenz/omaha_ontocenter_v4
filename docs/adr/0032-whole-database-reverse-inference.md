---
status: accepted
---

# Whole-database ontology reverse-inference with provenance-tagged drafts

> **Unaffected by ADR-0037 (Dataset/Pipeline data plane) — by design.** ADR-0037 introduces a transform layer between Connector and Ontology, but reverse-inference keeps reading the **raw source DB** (not a clean Dataset), precisely to preserve the FK-grounded honesty model below. The two are *parallel legs* off the same raw source, not stacked. See ADR-0037 §"Reverse-inference stays on the raw source."

## Context

The OPC's first design-time act (FDE Day 0-1) is turning a client's data into an ontology. The platform already has mature *single-table* schema inference (the data-ingestion skill: type inference, label/externalId candidates, low-cardinality→filterable, semantic annotation, single-table `xxx_id` relationship guessing). What is missing is *whole-ontology* inference: taking an entire data source and producing a complete draft (N object types + the relationships between them + hierarchy + allowedValues) as one snapshot, rather than creating types one file at a time in a conversation.

The gap is specifically cross-table structure, not field-level inference. And the single hardest, highest-value part — relationships — is exactly where guessing from column names produces confident-but-wrong results.

## What this step must guarantee for the OPC

The standard is **honesty, not accuracy**. A reverse-inferred draft that *looks* right but wires relationships wrong is worse than leaving them blank, because the OPC will trust it and the error propagates through publish → Agent → wrong answers for SMB end users (the project's core ADR-0026/0029 principle: never look accurate without being verifiable). Concretely:

1. **No false confidence.** The output must distinguish "certain" (backed by metadata) from "guessed" (heuristic), surfaced for OPC adjudication rather than blended into apparent fact.
2. **Draft is a starting point, not an endpoint.** Output is an editable Draft (ADR-0031). Goal is to remove ~80% of the grunt work and hand the remaining ~20% to the OPC clearly, not to be 100% right.
3. **Traceable.** Each inference carries its basis (this is a number because all values are numeric; these two tables are one-to-many because of a FK constraint) so the OPC can judge quickly.
4. **Incrementally re-entrant.** Inference merges into an existing Draft rather than overwriting, since client data arrives in waves.

## Decision

Prioritize **whole-database reverse-inference** (live DB connection). Keep the file path as-is (single-table, conversational) — do **not** upgrade it to multi-file whole-ontology inference.

Rationale: a DB connection exposes real metadata (FK constraints, declared column types, unique indexes, NOT NULL) via `information_schema`. This makes relationship inference *read* rather than *guess* — the only path that satisfies guarantee 1 at the strongest level, and the highest-leverage, safest scenario. Multi-file inference inherently guesses relationships (no FK), making it a false-confidence hotspot for high investment and low return; not worth it now. Most SMBs run a MySQL/PostgreSQL business DB.

Regardless of source, the reverse-inference **output carries provenance tags** on every inferred element: `metadata` (hard — from FK/constraint/declared type) vs `heuristic` (guessed — from naming convention / value sampling). This is the "honesty core". It is *not* abstracted into a unified source layer yet (rejected over-engineering with only two sources and evolving requirements); a third data source is when we extract the abstraction.

- DB source → mostly `metadata`-tagged, with a few `heuristic` weak relationships (pure naming convention).
- File source → unchanged single-table; relationships left for the OPC to wire by hand.

## Implementation note

Existing infra already queries `information_schema` for table names and column name/type (`CoreSdkService.listDbTables`/`previewDbTable`), with the MySQL-vs-PostgreSQL dialect branch in place. The new increment is focused: add a method that reads FK constraints + unique indexes from `information_schema`, plus a reverse-inferrer that assembles the cross-table snapshot. The connector and dialect plumbing are reused, not rebuilt.

## Consequences

- Reverse-inference output is the `@omaha/shared-types` ontology-snapshot shape (ADR-0031), extended with per-element provenance tags.
- The workbench renders `metadata` vs `heuristic` inferences distinctly so the OPC's confirmation cost is lowest on the guessed parts.
- Semantic annotation (description/unit) remains LLM-inferred and is therefore always `heuristic`-tagged regardless of source.

## Provenance classification rules

The `metadata` (hard) vs `heuristic` (guessed) line is a judgment rule, not just a label — some inferences look hard but are actually guesses. Fixed rules:

| Inference | Basis | Provenance |
|---|---|---|
| Field type (number/string/date/bool) | Declared column type (`decimal`, `varchar`, `timestamp`) | **metadata** |
| Phone/zip/leading-zero code is string not number | Declared `varchar` | **metadata** |
| Table A → B is one-to-many | FK constraint exists | **metadata** |
| Relationship from `xxx_id` column name, **no FK** | Naming convention | **heuristic** |
| `allowedValues` from scanning distinct values | Sampled column values | **heuristic** (red-flag: OPC confirms "is this the complete legal value set?") — current data having 4 distinct values does not mean the business has only 4; sample may be incomplete, and allowedValues is a hard-constraint gate that must not be treated as fact |
| externalId from a column | UNIQUE index | **candidate** (half-hard: "can be a key" is hard from the constraint; "should be *the* business key" is a semantic judgment — a table may have several unique columns. All unique columns are listed as candidates for the OPC to choose) |
| Field description / unit | LLM inference | **heuristic** |

The rule of thumb separating the two: a *constraint* the database enforces is `metadata`; a *semantic interpretation* of what the data means is `heuristic` (or `candidate` when the constraint proves feasibility but not intent).

