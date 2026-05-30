# 0029 — Query-plan transparency is a pre-launch gate; the chat UI must surface what the plan computed

**Status: accepted.** Related: [0028](./0028-keep-schema-projection-no-full-ontology-injection.md) / [0026](./0026-enum-constrained-tool-parameters-axis-a.md) / [0027](./0027-cross-relationship-aggregation-spike.md) (same baseline-first / live-LLM falsification discipline). Blocks the single-pilot launch.

## Context

Pre-launch readiness review for the **single-pilot + self-hosted** delivery form (same-tenant-fully-trusted; see memory `pilot-trust-model-field-perm`). The dominant product risk for an NL-to-data platform is not "can't answer" — it's **confidently answering wrong**: the Agent builds a subtly incorrect query plan, returns a plausible number, and the user acts on it.

Today the chat UI is a black box on this axis. `MessageList.tsx` declares `toolCalls` / `toolResults` on its message type but **never renders them** (126 lines, used only in the type). The user sees the final markdown answer plus a transient "calling tool…" pulse that disappears on completion. The backend already has the data — the SSE stream emits `tool_call{args}` and `tool_result{data}`, and `query.service` persists the `queryPlan` to the audit log — but none of it reaches the user at decision time.

## Decision

**Before the pilot goes live, the chat UI must surface a human-readable summary of the query plan behind any data-derived answer** (which object type, filters, grouping, aggregation) — not raw SQL, a back-translation. The backend data already exists; the gap is frontend rendering + a plan→prose step. This is the one launch-blocking item from the readiness review (health endpoint, rate limiting, etc. are post-launch because the pilot is self-operated).

## Evidence (live DeepSeek, demo-drama, N=8 × 12 questions = 96 calls; judgement B numeric correctness + A structural diagnosis)

Independent Postgres oracle (19811 shots / 427 episodes / 123 series); the same reducer ran on the question's intended spec (truth) and on the Agent's actual tool args (plan-replay). **Tier percentages decompose by root cause — the raw aggregates are misleading:**

| Tier | Raw plan-err | True plan-construction err | What the failures actually are |
|---|---|---|---|
| simple (Q1–4) | 0/29 | **0%** | count/sum/max on one object — fully reliable |
| medium (Q5–8) | 18/32 | **0%** | all "failures" = LLM picked literal `gt` for "超过" while truth used the prompt's `gte` convention — a *prompt* defect, not a plan defect |
| cross-rel (Q9–12) | 21/32 | **genuine, 1/8 to 8/8 per question** | wrong grain / missing groupBy / wrong reduction / proxy field |

Cross-relationship aggregation is where plans genuinely break:

- **Q11** "镜头最多的那部剧，一共有多少个镜头" (truth 688): **8/8** used `episode`+`count` with no groupBy (= 427, the episode count), then narrated a single episode's 119.
- **Q10** "哪部剧镜头最多" (argmax): **7/8** the same degenerate `episode`+`count`; only 1/8 took the correct `groupBy series` + `sum shotCount`.
- **Q12** "每部剧的镜头总时长里，最长的是多少秒" (truth 1475.5, DramaBox): 3/8 grouped by series but summed `clipDuration` (the episode's pre-aggregated field) → **1479.6**, and 5/8 took `max(clipDuration)` → 438.6 (wrong reduction). **1479.6 vs 1475.5 is a 0.3% difference, presented in a ranked table with "约24分40秒" — invisible to the naked eye.** A pilot user would trust it.
- **Q9** "每部剧的平均镜头时长里最高的" (truth 4.57): only **1/8** wrong — the `groupBy episode_shots.series` dot-path itself is reliable; the failures above are degenerate plans, not an inability to find the relationship.

The Q12 case is the crux: the answer is authoritative-looking, plausibly-numbered, and wrong, with **zero signal to the user** that the plan used the wrong field. That is the exact failure the transparency gate exists to expose.

## Consequences

- **Two findings beyond the gate.** (1) The aggregate tool's prompt convention ("大于X 倾向 gte") is wrong for "超过" (literally exclusive) and the LLM flip-flops gt/gte run-to-run on the same question — fix the prompt to distinguish 超过/大于(gt) from 至少/不少于(gte). (2) Cross-rel aggregation needs hardening (Q10/Q11/Q12) independent of the UI gate — but that is a separate work item; the UI gate makes the errors *visible*, which is the launch requirement.
- **Scope of the claim.** Measured on demo-drama with clean numeric/relational questions only; categorical filters were untestable because the seed `mood`/`shotSize` are free-text dirty (16521 / 329 distinct values — see memory `demo-drama-seed-dirtiness`). The probe was a one-shot; its files are deleted, evidence lives here.
- **Caveat.** 3/8 of one simple question (Q3) returned an empty response (no text, no tool call) under the 96-call burst — likely rate-limiting or `MAX_TOOL_ITERATIONS`, confounded with probe load; not treated as a product conclusion, re-verify under normal load.
- This converts the readiness question "can we open to enterprises?" into: **yes for the single self-hosted pilot, once the plan-transparency gate ships and the same-tenant-trusted precondition holds.**
