# ADR-0049: Market Drill-Down via Guided Multi-Turn, Not Single-Shot Cross-Star Chaining

## Status

Accepted (2026-06-12)

## Context

The Chunmi market intelligence system exposes three independent "star" object
types (`market_metric`, `brand_share`, `model_metric`; see ADR-0042/0043). The
`research_qa` skill encodes a four-hop decision chain (trend → share-decline →
price-band → competitor-SKU) so a brand manager can drill down, compare, and
break analysis down to the SKU level.

Hops ① and ② are **single-star** queries (filter/aggregate over one object
type). Hops ③ and ④ are **cross-star**: they carry a price-band interval from
`brand_share` into a `model_metric` `avgPrice` range filter, plus a derived
`launchDate` window for new-entrant detection.

A prior query-plan error-rate probe (N=8) established that the Agent's
natural-language → query-plan translation is reliable for single-star queries
(0% error) but fails **50–100% per question** on cross-relationship queries —
including silent wrong answers (e.g. returning 1479.6 where the truth is
1475.5, an "invisible wrong answer" that looks correct). The query *engine* can
express these joins (Field Path, ADR-0044); the *Agent* cannot be trusted to
target them correctly in one shot.

The original `research_qa` prompt encouraged exactly the unreliable behavior:
walk all four hops in a single reply, self-assembling the price-band interval
and new-entrant window with no checkpoint where the user could catch an error.

## Decision

Reframe the four-hop chain from **single-shot cross-star chaining** to
**guided multi-turn drill-down**, with the stop boundary placed at the
reliability seam:

- **①② run continuously** — both are single-star, so the Agent executes them
  and presents the combined intermediate result.
- **Before ③④ the Agent must stop** — surface the intermediate conclusion and
  the concrete parameters it intends to use next (category, brand, price-band
  min/max, period), and wait for the user to confirm or correct before issuing
  the cross-star query.

This trades latency (more conversational turns) for accuracy: every executed
query stays on the reliable single-star path, and the dangerous cross-star step
is decomposed into a user-visible, user-confirmable parameter hand-off rather
than an opaque self-join.

The stop is **prompt-enforced only** — there is no programmatic interrupt in
the orchestrator. If DeepSeek proves unreliable at honoring "present and wait"
instructions in practice, the fallback is a `confirm_drill_down` guard tool the
Agent must call to unlock the model-layer query (not implemented now).

## Consequences

- `research_qa.skill.ts` decision-chain section rewritten; ①② marked
  continuous, a stop-and-confirm checkpoint inserted before ③, and ③④ marked
  "用户确认后执行".
- The skill spec asserts the prompt contains the stop-and-confirm contract so
  the behavior can't be silently dropped in a future edit.
- Coverage-honesty rules (ADR-0043) and universe-distinction rules are
  unchanged — they compose with the new checkpoint.
