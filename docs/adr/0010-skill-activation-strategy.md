# Skill Activation: All-Active Union with Soft Token Budget

The Agent activates all registered Skills simultaneously on every turn — base prompt + every Skill's `systemPrompt()` is concatenated into the system message, and the union of all Skills' declared `tools[]` arrays is sent to the LLM. There is no per-turn intent classifier and no two-stage activation. Prompt budget enforcement is monitoring-only (warn at >4000 tokens, error at >5000), not a hard gate.

## Why

Target SMB conversations are frequently cross-domain ("import this Excel, then find A-grade customers in it") and a single user message can implicate multiple Skills mid-thought. Forcing per-turn Skill selection — either by an upstream classifier LLM call or by mutual exclusivity — introduces routing errors at exactly the boundary cases that matter: "import 完了帮我查一下" is genuinely both data-ingestion and query intent. Activating everything at once is robust to fuzzy intent at the cost of a fixed prompt overhead.

The fixed cost today is ~1050 system-prompt tokens for 3 Skills, leaving ~4000 token headroom under the 5000-token budget. The relevant question is not "is the prompt long?" but "do edge-case Skill misclassifications cost more than the extra tokens?" — and for the current scale (3 Skills, SMB user base) the answer is yes.

## Considered Options

**All-active union vs single-Skill activation per turn.** Single-Skill activation requires an intent classifier — either a small LLM call or a rules engine — running before the main LLM call. Each adds a failure mode: classifier returns wrong Skill on ambiguous input, classifier itself adds latency, and switching between Skills inside one user message becomes hard. Rejected for current scale; revisit when monitoring shows the cost.

**All-active union vs primary-Skill-with-secondaries model.** A "primary Skill gets full prompt, others get only name + description" middle ground was considered. Rejected for now: it shifts complexity into a Skill-priority decision that has no clear answer today, and the token saving is marginal until prompt grows much larger.

**Hard cap vs soft budget for prompt length.** A hard cap that refuses to start the Agent if the system prompt exceeds 5000 tokens was considered. Rejected because the budget is a guideline, not a correctness boundary — exceeding it degrades quality gradually, not catastrophically. Soft monitoring (warn/error logs with `conversationId`) gives the same early-warning signal without risk of the Agent failing to start in production from a Skill prompt that grew during a refactor.

**Approximate vs exact token counting.** Approximate counting via `chars / 1.5` for prediction; exact counting via the LLM response's `prompt_tokens` field for retrospective truth. Bringing in `tiktoken` or similar for exact prediction was rejected because the budget is coarse — a 20% estimation error only changes the warning threshold from 4000 to ~5000, not enough to justify a tokenizer dependency.

**Automatic two-stage activation when budget is exceeded vs manual intervention.** An automatic switch to a two-stage activation (LLM picks Skills first, then full prompt is injected) when prompt exceeds 5000 tokens was considered. Rejected: the two-stage protocol itself is a non-trivial design (which Skills to expose to the picker, fallback when picker chooses wrong, additional latency) that should be its own ADR when the trigger actually fires. Today, the monitoring logs are the trigger — when an `error`-level log appears, that's the cue to design two-stage activation, not before.

## Consequences

- **Prompt overhead is fixed per turn**, regardless of user intent. Adding a Skill increases this overhead by roughly its `systemPrompt()` length. Skill authors should treat prompt length as a shared resource.
- **Tool scoping filter remains in place** even though today's union-of-all-Skills covers every registered tool. The filter is a structural seam: when two-stage activation arrives, the same code path narrows the tool set per active Skill. Removing the filter today would mean re-adding it (and its test) later — a deletion-test-fail.
- **Orphan tool detection runs at module init**. A tool registered in `agent.module.ts` but not declared in any Skill's `tools[]` will never be sent to the LLM and so can never be invoked. This is treated as a configuration error and the AgentModule fails to start — different from prompt budget overflow, which is graceful degradation. The two cases sit on opposite sides of "is this a feature loss or a quality slope?"
- **Token monitoring is dual-track.** Pre-call estimation via `chars / 1.5` produces warn/error logs at 4000/5000 thresholds; post-call truth comes from `response.usage.prompt_tokens` recorded per request. Logs include `conversationId` so a triggered alert can be replayed against `Conversation` history. NestJS `Logger` is the transport — no log aggregation system is wired today; structured-log adoption (pino, etc.) is deferred until one is.
- **No automatic Skill ramp-up logic.** When monitoring fires, the response is human: split a Skill, trim a prompt, or design two-stage activation as a follow-up ADR. The Agent does not silently switch behavior under load.
- **The 5000-token budget covers the system prompt only** (base + active Skills). Tool definitions (today ~1780 tokens for 13 tools), conversation history, and tool-result payloads are separate concerns — the latter is what `buildLlmHistory` compression (deferred) will eventually address.
- **This decision is reversible**. Switching to two-stage activation requires changes to `AgentService.executeLoop` and a new component for Skill selection, but does not require re-thinking the Skill/SDK/Tool layering from ADR-0008. The activation strategy is layered on top of the architecture, not embedded in it.
