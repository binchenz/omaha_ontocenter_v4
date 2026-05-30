# Cross-relationship aggregation (`rel.field` dot-path): spike to falsify whether DeepSeek traverses links

Status: spike in progress (baseline-first)
Date: 2026-05-30

## Context

The query engine aggregates over a **single** `objectType` only (`aggregate_objects` takes one `objectType`; groupBy/metrics/filters all resolve via `properties->>'field'` on that one type — query-planner.service.ts:118–291). It cannot group shots by a field that lives on the related episode.

The drama domain has exactly this need: `episode --episode_shots(one-to-many)--> shot`, with `series` on `episode.properties` and `duration` on `shot.properties`. The foreign key `episode_shots` is stored on each **shot**'s `relationships` JSONB pointing at the parent episode's `external_id` (seed.ts:161). So "which series has the longest average shot duration" requires traversing shot→episode (reverse of the declared link direction) and grouping by `episode.series`.

This is the real wall behind the S4 "false green" (ADR-0026): the drama-query S4 test asserts `groupBy:['series']` on `shot` — which **always throws** `PROPERTY_NOT_GROUPABLE` because series isn't a shot field. The test is green because it asserts arguments and never executes; at runtime main self-heals into a non-cross-series wrong answer.

## Decision (shape, pre-validation)

Add a cross-relationship group key as a **dot-path string**: `groupBy: ["episode_shots.series"]` (chosen in grilling over a `{via,field}` object form). Rationale is behavioral, not aesthetic: DeepSeek handled structured/mixed-type params badly (oneOf refuted, ADR-0026), but dot-path field access is a universal SQL/GraphQL intuition and keeps `groupBy` as `string[]` — no schema-shape change.

- **Relation name, not type name.** LLM copies the name verbatim from the schema string (`关系：episode→shot(episode_shots)`). It does NOT need to understand link direction.
- **Planner resolves direction bidirectionally.** Relation names are globally unique, so the planner looks the name up in both the current type's outbound relations and inbound relations pointing at it, finds `episode_shots` is the inbound episode→shot link, and joins `shot.relationships->>'episode_shots' = episode.external_id`. Direction reasoning lives in deterministic server code, never in the model — per the hard lesson: anything the server can resolve deterministically, never gamble on the LLM.

## The hypothesis under test (falsifiable)

Given the schema shows `episode→shot(episode_shots)`, will DeepSeek autonomously emit `groupBy:["episode_shots.series"]` for "aggregate shots by series" queries — i.e. reason through "series isn't on shot, but a link reaches episode, which has series"?

Two orthogonal things, validated separately:
1. **Mechanism (deterministic):** planner parses dot-path → resolves relation bidirectionally → emits JOIN SQL → result equals direct-SQL ground truth. Unit-tested. If this isn't 100%, the spike dies here.
2. **Behavior (LLM):** does DeepSeek generate the dot-path. This is the real gamble, measured over N live calls.

## Ground truth (phase 0, direct SQL on demo-drama, 19811 shots / 427 episodes / 123 series)

- **X1** "which series has the longest average shot duration": `Reborn Villain Heir Turns the Script Around`, avg=4.57s, n=73.
- **X2** "which series uses the most distinct shotSize values": `From Mail-Order Bride To Billionaire's Wife`, distinct=48 (rest cluster at 28–31 — an unguessable answer, so a clean cross-relationship trap).

X-class deliberately **excludes** "how many shots per series" because episode has a `shotCount` property, letting the LLM take a `SUM(episode.shotCount)` local shortcut that would contaminate the measurement.

## Scenarios & metrics

- **X1, X2** (cross-relationship, no local shortcut) — the wall today.
- **L1** "shots per shotSize" (pure-local groupBy) — regression guard.

Per scenario, N=6:
- `generatedCrossRel` — did the LLM emit a `rel.field` dot-path (behavioral core).
- `firstCallLegal` — first data-tool call is the correct cross-relationship aggregate.
- `finalAnswerCorrect` — **final text answer names the ground-truth series.** Not "rows returned" — the actual series must be right. This is the anti-false-green guard; self-heal artifacts never count.

## Phases (baseline-first)

| phase | action | nature |
|---|---|---|
| 0 | direct-SQL ground truth | deterministic — **done** |
| 1 | baseline: X-class on pristine main, N=6 | LLM — capture the *failure shape* (honest "can't" vs confident wrong answer) |
| 2 | implement planner dot-path + unit-test vs ground truth | deterministic |
| 3 | tool prose teaches dot-path (generic syntax only, not X1/X2 verbatim) | — |
| 4 | after: same X+L, N=6 | LLM — did dot-path get generated; did final answer become correct |

## Success criterion (declared up front)

- Mechanism (phase 2): unit SQL == ground truth, 100%. Else spike dies.
- Behavior (phase 4): X-class `generatedCrossRel` ≈ N/N **and** `finalAnswerCorrect` rises from baseline ~0 to ≈ N/N; L1 no regression.
- **If behavior fails** (dot-path offered but unused/misused), the conclusion mirrors ADR-0026: cross-relationship reasoning is a DeepSeek blind spot, b/c are even less likely, and the honest endpoint is "prose + self-heal, accept the ceiling" — stated plainly to the user, not papered over.

Anti-self-deception: prose teaches only the generic `"relationName.field"` syntax, never X1/X2 phrasings; X-class uses varied wordings to avoid template-matching artifacts.

## Phase 1 baseline result (pristine main, N=6) — the failure shape, captured

| scenario | generatedCrossRel | firstCallCrossLegal | illegalLocalGroupBy | someDataCallThrew | **finalAnswerCorrect** |
|---|---|---|---|---|---|
| X1 avg shot duration / series | 5/6 | 0/6 | 5/6 | 4/6 | **2/6** |
| X2 distinct shotSize / series | 3/6 | 0/6 | 3/6 | 2/6 | **0/6** |
| L1 local (control) | — | — | 0/6 | 0/6 | — |

Three failure shapes, all pinned:
1. **Illegal-local-groupBy → throw → self-heal thrash** (X1 run4/5, X2 several): the LLM repeatedly tries `groupBy:['series']` on shot → `PROPERTY_NOT_GROUPABLE` → self-heals → retries, data-call count climbs to **7–10**, ends `ok=false` empty. Worst shape for the user.
2. **Detour-and-approximate → wrong** (X1 run0/2): the LLM cleverly reroutes to "aggregate episode for series-dimension totals, then hand-compute the average." run0 literally says *"shot has no series field (series is on episode), so I aggregated by series via the episode table."* The model **fully understands the cross-relationship gap** — it just can't cross, so it approximates with episode's `clipDuration`/`shotCount`. X1 occasionally lands (2/6, head series happens to stand out); X2 never (0/6).
3. **X2 systematically wrong (0/6)** — the cleanest evidence: "distinct shotSize per series" has **no episode-side proxy field**, so no amount of detouring computes it. 6/6 `ok=false`.

L1 control is healthy (0/6 illegal, 0/6 throw): the existing local-aggregate path is intact and must not regress.

**Key insight — different failure than ADR-0026, and more favorable.** Axis A failed because DeepSeek *ignores* structural constraints. Here the model **understands the cross-relationship semantics** (run0 names it explicitly) — it isn't confused, it lacks a *legal syntax* to express the traversal. It emits bare `series` (5/6, 3/6) precisely reaching for the capability that doesn't exist. So the spike hypothesis is *more* likely than axis A's: the model already intends to cross; give it `episode_shots.series` + prose and it will probably use it, because the only current outlet (bare `series`) is illegal. baseline-first decomposed the "false green" into **capability gap (real) + model already has cross-relationship intent (unexpected good news).**

## Phase 4 after-run result — HYPOTHESIS CONFIRMED

Mechanism gate (phase 2): 5/5 green. SQL equals direct-SQL ground truth for X1 and X2.

| scenario | metric | baseline | after | criterion |
|---|---|---|---|---|
| X1 avg duration/series | generatedCrossRel | 5/6 | **6/6** | ✅ |
| | firstCallCrossLegal | 0/6 | **6/6** | ✅ |
| | illegalLocalGroupBy | 5/6 | **0/6** | ✅ |
| | someDataCallThrew | 4/6 | **0/6** | ✅ |
| | **finalAnswerCorrect** | 2/6 | **6/6** | ✅ |
| X2 distinct shotSize/series | generatedCrossRel | 3/6 | **6/6** | ✅ |
| | firstCallCrossLegal | 0/6 | **3/6** | ⚠️ partial |
| | illegalLocalGroupBy | 3/6 | **1/6** | ✅ |
| | **finalAnswerCorrect** | 0/6 | **5/6** | ✅ |
| L1 local (regression) | illegalLocalGroupBy | 0/6 | **0/6** | ✅ no regression |

**Conclusion: spike hypothesis confirmed.** The dot-path `"relationName.field"` syntax, combined with a generic prose example (non-domain, to prevent template-copying), was sufficient for DeepSeek to:
1. Recognize that the target field lives on the related type (not the base type).
2. Look up the relation name from the schema string.
3. Emit the correct cross-relationship groupBy on the first call (X1: 6/6; X2: 3/6 first-call, 5/6 final).
4. Receive a correct answer from the engine (ground-truth series names, exact numeric values).

X2's partial first-call rate (3/6) is acceptable: `countDistinct` is a more complex metric shape; the model sometimes needs one retry to land on the right combination, but `finalAnswerCorrect` is 5/6. The one X2 failure (run0, 9 calls, threw) is a self-heal thrash on an edge case, not a systematic failure.

**Contrast with ADR-0026 (axis A):** Axis A gave the model structural constraints it *ignored*. This spike gave the model a *capability* it was already reaching for — the model understood the semantics, lacked the syntax. That asymmetry is why this worked and axis A didn't: you can teach syntax, you cannot enforce constraints on DeepSeek's function-calling.

**What was shipped:**
- `OntologyViewLoader.resolveRelationByName` — bidirectional relation lookup by name (direction-agnostic; model never reasons about link direction).
- `QueryPlannerService.planCrossRelAggregate` + `buildCrossRelSql` — subquery-isolated JOIN SQL; existing `ScopedWhere` untouched.
- `aggregate_objects` tool prose — generic dot-path syntax with a non-domain example.
- Mechanism gate: `cross-rel-mechanism.e2e-spec.ts` (5 tests, deterministic, no LLM).
- Measurement harness: `cross-rel-aggregation.e2e-spec.ts` (baseline-first, finalAnswerCorrect anti-false-green guard).



