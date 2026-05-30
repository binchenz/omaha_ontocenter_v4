# Enum-constrained tool parameters (Axis A): conditional `oneOf` works on deepseek-chat; flat-union enums are actively harmful

For the Agent's data tools (`query_objects`, `aggregate_objects`), field-valued parameters (`groupBy[]`, `metrics[].field`, `filters[].field`) should be constrained to the chosen `objectType`'s **real fields** via a **conditional JSON Schema** (`oneOf` branched on `objectType`), generated per-request from the resolved `OntologyView`. A **flat-union enum** (one enum = the union of every type's fields) must NOT be used — it is measurably worse than no enum at all. This decision records the spike evidence behind that split; the full-pipeline implementation is a separate task gated on an end-to-end falsification suite.

## Why — the three-probe evidence

The question driving this was "axis A": does making field affordance **structural** (the schema forbids illegal fields) beat conveying it in **prose** (tool descriptions + ADR-0023 annotations)? Prose is probabilistic — a prior projection redesign that read clean on paper regressed live LLM behavior 9/9 → 7/9 (see [[demo-drama-dual-path]] context and ADR-0025). So axis A was tested against live `deepseek-chat` before any implementation, using the demo-drama ontology and the S4 decoy query "哪部剧特写镜头最多？".

The decoy is maximally adversarial: it semantically wants *group by series (剧名)*, but `series` lives **only on `episode`**, never on `shot` (verified in the DB: shot has 15 fields, none named series; episode has series/episodeNo/clipDuration/shotCount; 19811 shots / 427 episodes). Grouping `shot` by `series` is therefore an **illegal query** — the query planner throws `PROPERTY_NOT_GROUPABLE` (query-planner.service.ts:133, gated on `view.filterableFields`).

Three schema shapes, same query, N=8 each, temperature 0.7:

| Schema shape | illegal `series`-on-`shot` | legal | reading |
|---|---|---|---|
| **Conditional `oneOf`** (branch on objectType) | **0/8** | 8/8 | model honors the branch strictly |
| **Flat-union enum** (both types' fields in one enum) | **5/8** | 3/8 | enum *induces* the illegal pick |
| **Free strings** (= main today) | **2/8** | 6/8 | status quo |

Three conclusions, each load-bearing:

1. **`oneOf` is viable on deepseek-chat (8/8).** The model both *understands* and *strictly obeys* a schema that constrains fields by the chosen `objectType`. This refutes the worry that axis A could only be realized as per-type tools ("axis B"). A single tool with a conditional schema is enough — axis A stands on its own.

2. **Flat-union enums are a trap — worse than free strings (5/8 vs 2/8 illegal).** Putting `series` in the same enum the model reads while `objectType=shot` *tells the model `series` is a legal shot field*, and it takes the bait more often than when given no enum at all. The lesson is sharp: enum-constrain fields **correctly (per-type branch)** or **not at all**. A half-measure union enum is negative work.

3. **Main today has a quantified 2/8 (~25%) illegal-query rate on this class of query.** The drama-query e2e suite reads 9/9 green, but S4 only asserts the *tool-call arguments*, never executes the query — so it cannot see that ~1/4 of S4 runs produce a query that throws `PROPERTY_NOT_GROUPABLE`. S4 is a **false green**: the LLM picks the right *intent* (group by drama) but an illegal *field* (series on shot). This is a distinct, larger finding — the engine cannot group one object type by another's field (cross-object aggregation) — tracked separately as its own capability gap, not as part of axis A.

## Consequences

- **The conditional schema is generated per-request, not authored statically.** The seam already exists: orchestrator.service.ts:117-126 injects an `objectType` enum into `query_objects`/`aggregate_objects` per request from `objectTypeNames`. Axis A extends that same hook to emit `oneOf` branches — one per object type — each branch's `groupBy`/`metrics[].field`/`filters[].field` enums sourced from that type's `OntologyView` (`filterableFields`, `numericFields`). No tool is hand-edited.

- **Axis A is a *complement* to prose, not a replacement.** The enum forbids *non-existent / non-filterable* fields (the B-class failure: e.g. grouping by `narration`, which has no `filterable` flag → would throw). It does **not** help choose between *legal sibling* fields of the same meaning-family (the A-class failure: `startTime` vs `duration` vs `endTime`, all legal, all in-enum). Sibling disambiguation remains the job of ADR-0023 prose (scale + navigation + boundary in `description`). An earlier framing of axis A as "eliminating prose" was wrong; it eliminates *one class* of failure and leaves the other to prose.

- **This spike is not product validation.** The 8/8 was a single-turn call with a minimal system prompt. The full pipeline adds a multi-thousand-token system prompt, conversation history, and skill injection; whether `oneOf` is still honored under that noise is **unverified**. Adoption is gated on (a) building an end-to-end falsification suite that actually executes queries and splits B-class (axis A should improve) from A-class (axis A should hold, not regress) scoring, and (b) axis A winning it in the real pipeline. The same bar the projection redesign failed.

- **Probe scripts** (`apps/core-api/probe-*.cjs`) are throwaway and should be deleted once this ADR captures their output; they are not part of the test suite.

## Pre-implementation baseline (pristine main, full pipeline)

The falsification harness (`apps/core-api/test/axis-a-falsification.e2e-spec.ts`, measurement-only) was run on pristine main, N=6 per scenario, full product pipeline (real system prompt + skills + history), against demo-drama. This is the **before** that axis A must beat. Two trustworthy primary metrics: `firstLegal` (first data-tool call uses only fields legal for the chosen objectType) and `retry` (run made >1 data-tool call ⇒ a thrown illegal query was self-healed).

| group | scenario (lure) | firstLegal | retry |
|---|---|---|---|
| B | B1 groupBy narration | 1/6 | 6/6 |
| B | B2 groupBy/filter audio | 4/6 | 5/6 |
| B | B3 groupBy subtitle | 4/6 | 6/6 |
| B | B4 groupBy action | 1/6 | 6/6 |
| **B** | **headline** | **10/24 (42%)** | **23/24 (96%)** |
| A | A1 startTime vs siblings | 6/6 | 0/6 |
| A | A2 duration vs siblings | 6/6 | 0/6 |
| A | A3 shotNum ordinal | 6/6 | 0/6 |
| **A** | **headline** | **18/18 (100%)** | **0/18** |
| DIAG | B5 S4 decoy (series-on-shot) | 1/6 | 6/6 |

Readings:

1. **The B-class failure is real, stable, and severe.** On non-filterable-field lures, main picks an illegal field on the first call 58% of the time and triggers an error→retry roundtrip 96% of the time. This is the failure axis A targets; the spike's 2/8 was a floor, not the ceiling.

2. **The A-class control is perfect on main (18/18, 0 retries, correct sibling field 6/6 each).** ADR-0023 prose already disambiguates legal siblings reliably. This sets a hard non-regression bar: axis A must keep A at 18/18. Any A-group drop = a projection-redesign-style side-effect and grounds to reject axis A even if B improves.

3. **S4 is a false green, quantified in the real pipeline: 5/6 first-call illegal** (`groupBy series` on `shot`). The drama-query 9/9 baseline survives only because S4 asserts arguments, never executes, and main self-heals (retry 6/6). Cross-object aggregation is the underlying gap — its own line, not axis A.

Method caveat: the `finalOk` column from this baseline run is **void** — it used a pre-fix payload-shape check (`items`/`groups`) that mismatches the real SDK shapes (`{data,meta}` for query, `{data:{groups}}` for aggregate), so it false-zeroed A group despite 0 retries + correct fields proving success. The harness was corrected after this run; `firstLegal`/`retry` were unaffected (they read tool-call args + call/result counts) and remain the primary axis-A metrics.

Axis-A success criterion: **B `firstLegal` → ~24/24 with `retry` → ~0, while A stays 18/18.**

## After-implementation result — REFUTED in the full pipeline

Dynamic `oneOf` was implemented (`injectFieldOneOf`, orchestrator.service.ts), unit-tested (one branch per type, per-type enums, series excluded from shot groupBy — all green), and the harness re-run N=6, full pipeline.

| group | metric | baseline (main) | after (oneOf) | criterion | verdict |
|---|---|---|---|---|---|
| **B** | firstLegal | 10/24 (42%) | **13/24 (54%)** | ~24/24 | ❌ missed |
| **B** | retry | 23/24 (96%) | **24/24 (100%)** | ~0 | ❌ worse |
| **A** | correct field | 18/18 | **18/18** | hold | ✅ no regression |
| **DIAG/S4** | firstLegal | 1/6 | **6/6** | — | ✅ only win |

**Refutation, proven from the request dump (not inferred):** the `oneOf` was correctly injected into the request DeepSeek received — `objectType.enum:["episode","shot"]`, `oneOf` 2 branches, shot's `groupBy` enum excluded `narration` (`narration in shot groupBy? false`). Yet `0002.json` shows DeepSeek generated `aggregate_objects ot=shot groupBy:["narration"]` anyway — **an enum-violating value the branch explicitly forbade.**

**Conclusion: probe finding #1 ("oneOf is viable on deepseek-chat, 8/8") does NOT hold in the real product pipeline (14 tools, ~3068-char system prompt).** DeepSeek's OpenAI-style function-calling treats `oneOf`/`enum` as a generation *hint*, not a hard constraint — no rejection sampling. The 8/8 probe was an artifact of a low-noise single-tool context. Under real prompt load the model freely emits out-of-enum values. `finalOk=24/24` after is an artifact of self-heal retries, **not** structural enforcement.

This is the same failure shape as the projection redesign (clean on paper, 9/9→7/9 in behavior): only end-to-end behavioral testing measured the truth, and baseline-first stopped a theoretically-justified-but-ineffective change before full investment. Axis A as single-tool conditional `oneOf` is **behaviorally refuted on deepseek-chat**. Realizing it as per-type tools (axis B) is unvalidated and likely fails the same way (same soft-constraint mechanism); the honest local optimum on this model stack is **prose + service-side validation + self-heal**. The one durable signal: cross-object aggregation (S4/B5) is a real *capability* gap, not a constraint-enforcement problem — pursued separately (see ADR-0027).



