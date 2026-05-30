---
status: accepted
---

# Accuracy Evals: productize the throwaway probe into a publish-gating closed loop

## Context

ADR-0029's query-plan error-rate probe was a one-shot e2e spec (`drama-query.e2e-spec.ts`): hardcoded NL questions → `postSse('/agent/chat')` → assertions on the generated query plan, run via `runWithRetry`. It was the manual prototype of an Eval. The OPC needs this as a repeatable pre-publish acceptance tool (FDE's AIP Evals) — the only objective go/no-go evidence before exposing an ontology to SMB end users (ADR-0030 step 2, gating ADR-0031's Publish).

Productizing is not "move the script over". Three properties of the probe each need a decision: the question bank was hardcoded in `it()` blocks; truth was hardcoded `expect().toContain` assertions; and it ran as a developer `pnpm test`, not an OPC button-click. The OPC is not an engineer.

## Decision

**Scoring compares query-plan *structure*, not final numbers.** ADR-0029's deepest traps came from number-based judging: the gt/gte artifact (literally-correct answers scored as errors) and Q12's invisible wrong answer (1479.6 vs 1475.5). Structural scoring — did it hit the right object type, metric (sum/avg/count), filtered/aggregated/grouped field, groupBy, cross-relationship dot-path — sidesteps both. Same source as the plan-transparency back-translation (ADR-0029 ships PlanSummarizer).

**Questions are authored by *capture*, not by writing JSON.** The OPC asks a question in normal chat; the Agent answers and its plan is back-translated to plain language (reusing the plan-transparency feature); if the OPC judges the plan correct, one click "add to Evals as the expected baseline" captures that correct plan as the expected structure. Zero hand-written JSON. This re-purposes the plan-transparency feature from "shown to end users" into "the OPC's entry point for establishing acceptance baselines" — one feature, two uses.

**Only semantic-core fields are compared**: objectType, metric, the aggregated/filtered/grouped field, groupBy, cross-relationship dot-path. Execution details (limit, default orderBy, select column order) are ignored. Comparing the whole plan strictly would misfire on noise (limit/orderBy differences) — false negatives that make the OPC distrust and abandon Evals. Comparing only objectType would be too loose (false positives).

**Run the full N repetitions, compute per-question pass rate, expose non-determinism rather than hide it.** The existing `runWithRetry` is "retry on failure, pass if any attempt passes" — correct for e2e, *wrong* for Evals, because it masks the very non-determinism the OPC must see (ADR-0029 found cross-rel questions fluctuating 1/8–8/8). A question that is 8/8 and one that is 5/8 carry completely different delivery confidence.

**Publish gate is a soft gate with informed publish.** Questions below a pass-rate threshold are highlighted as warnings; the OPC may publish anyway (trusted single-tenant operator, theirs to decide) but must explicitly confirm having seen the unstable questions. Same "informed gate" philosophy as the publish preflight (ADR-0031), kept consistent across the product.

## Considered Options (scoring)

- Compare final numbers — intuitive but hits the ADR-0029 traps; OPC must know the right number in advance (usually doesn't). Rejected.
- LLM-as-judge — no predefined answer needed, but the judge itself errs/drifts and ADR-0029 showed it unreliable on boundary semantics. Rejected as primary.
- Three-way (structure + numbers + LLM judge) — most complete, heaviest, and conflicting signals push judgment back onto the OPC. Deferred.

## Consequences

- The question bank, captured expected-plans, and pass-rate history become persisted per-tenant design-time data (not test code).
- Evals run against a Draft's Agent (ADR-0031), pre-publish, on demand from the workbench — not in CI.
- The semantic-core field set is the contract between capture and scoring; it must track the query-plan shape as the planner evolves.
- N (repetition count) and the pass-rate threshold are OPC-tunable, defaulting to the probe's N=8.
