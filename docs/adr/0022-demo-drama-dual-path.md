# demo-drama: dual-path design — deterministic e2e baseline + conversational ingestion demo

The `demo-drama` tenant (short drama shot analysis) serves two purposes that pull in opposite directions: proving the semantic layer disambiguates correctly in a non-commerce domain (requires stable, deterministic field names and annotations for e2e assertions), and demonstrating the full "conversational ingestion → auto-inferred schema → queryable data" narrative (requires a real LLM-driven ingestion run, which is non-deterministic).

We resolve this by running two separate paths over the same source data:

**Path ①  — e2e baseline (deterministic).** `scripts/demo-drama/setup.ts` + `ontology.ts` bootstrap a fixed schema with hand-authored `description`/`unit` annotations. `scripts/demo-drama/seed.ts` pulls data from the HTTP source and inserts it directly. `drama-query.e2e-spec.ts` asserts against this stable schema (e.g. "短的镜头" must resolve to `duration`, not `shotNum`). Annotations are hand-written here because the e2e is testing *disambiguation given correct annotations*, not annotation inference.

**Path ②  — conversational ingestion demo (non-deterministic).** A separate demo script loads the same source data into a staging Postgres table, then drives the Agent through the DataIngestionSkill flow (connect DB → list tables → infer schema including `description`/`unit` → confirm → import). This proves the "upload/connect → Agent auto-models → queryable" narrative end-to-end. It is not run in CI; it is a human-facing demo.

## Considered options

- **Single path, Agent-inferred annotations, e2e asserts on frozen snapshot** — rejected: every schema refresh requires re-aligning test assertions; the snapshot obscures whether the live Agent still infers correctly.
- **Single path, hand-written annotations, no conversational demo** — rejected: doesn't demonstrate the DataIngestionSkill's semantic inference capability in a non-trivial domain.
- **Relax e2e assertions to semantic rather than field-name level** — rejected: the whole point of S1 ("短的镜头" → `duration` not `shotNum`) is a precise field-name disambiguation; loosening the assertion removes the signal.

## Relationship to drama-co

`demo-drama` nominally supersedes the `drama_co` customer engagement. The drama-co ingest code was removed in the open-source cleanup commit (`c5d2e84`). `docs/deployment.md` and the `test:drama-agent` script reference in `scripts/package.json` are stale and should be cleaned up. The HTTP source (`http://142.202.71.28:5080`) is a one-shot demo data feed, not a production data path; real customer ingestion continues to use RDS + IngestRecipe (ADR-0016).
