# PRD: Skill Activation — Prompt Budget Monitoring + Orphan Tool Check

## Problem Statement

Today, three Skills are always active and the agent sends every registered Tool to the LLM on every turn. This works, but two silent failure modes exist:

1. **No visibility into prompt growth.** Adding a new Skill (or extending an existing one's `systemPrompt`) silently bloats the system prompt. There is no signal when the combined prompt approaches or exceeds its budget. When the LLM's response quality degrades, it is not obvious the cause is prompt length.
2. **A registered Tool that no Skill declares is orphaned and unreachable.** If someone adds `MyNewTool` to `AgentModule` but forgets to add `'my_new_tool'` to any Skill's `tools[]`, the agent-level filter (from ADR-0010) silently strips it out. The Tool exists, the UI might reference it, but the LLM never sees it — and no test or startup check catches this.

The recent `ConfirmationGate` DI bug also exposed a related gap: `AgentModule` can fail to boot for reasons that all unit tests miss, and the first signal the user gets is a "fetch failed" error in the browser.

## Solution

Three small changes that turn silent failures into loud ones:

1. **Soft prompt budget monitoring.** On every turn, estimate the system prompt's token count (`chars / 1.5`). Log a warning at >4000 tokens and an error at >5000 tokens — both include the `conversationId` — but never block the request. Separately, log the real `prompt_tokens` from every LLM response so operators can compare estimate vs truth.
2. **Orphan Tool check at boot.** On `AgentModule` initialization, verify every registered Tool name appears in at least one Skill's `tools[]`. If any Tool is orphaned, the module fails to start with a clear error listing the offending Tool names. Configuration bugs become boot errors, not silent feature loss.
3. **Module-boot smoke test.** A single test that constructs `AgentModule` through NestJS's DI container and asserts `AgentService` resolves. This would have caught the `ConfirmationGate(Map)` bug in 3 seconds instead of after a production restart.

All three are consequences of ADR-0010.

## User Stories

1. As a Skill author, I want the agent to log a warning when my Skill's prompt pushes the total over 4000 tokens, so that I notice prompt bloat before it degrades responses.
2. As a Skill author, I want the agent to log an error when the system prompt exceeds 5000 tokens, so that I get an unambiguous signal that the soft budget is breached.
3. As a Skill author, I want my warning/error logs to include the `conversationId`, so that I can replay the conversation that triggered the alert against the stored turns.
4. As an operator, I want to see the real `prompt_tokens` from every LLM response in the logs, so that I can calibrate the `chars / 1.5` heuristic against DeepSeek's actual tokenizer.
5. As a Skill author, I want the agent to continue serving requests even when the prompt exceeds the budget, so that a single over-budget turn does not break production.
6. As a Tool author, I want the agent module to fail to boot if I register a Tool that no Skill declares, so that I know immediately that my Tool is unreachable.
7. As a Tool author, I want the boot error to list the orphaned Tool names, so that I can add the missing entry to a Skill's `tools[]` without hunting.
8. As a developer making agent changes, I want a single smoke test that boots `AgentModule` through NestJS DI, so that DI resolution bugs are caught in CI instead of in production.
9. As a developer, I want the smoke test to be cheap and fast, so that it runs on every CI run without slowing the suite.
10. As a maintainer, I want the prompt-estimation logic to be pure and testable in isolation, so that tuning the heuristic or budget thresholds does not require running the full agent loop.
11. As a maintainer, I want the orphan-check logic to be pure and testable in isolation, so that it can be verified without a live NestJS container.
12. As a Skill author, I want a Skill's `systemPrompt()` output length to not affect Tool visibility, so that the two concerns remain independent.

## Implementation Decisions

### Modules to build/modify

- **`AgentService.buildSystemPrompt`** — after assembling the prompt, compute the estimated token count, compare against 4000/5000 thresholds, and emit NestJS `Logger` messages. Pass `conversationId` through the call chain so it can appear in log lines.
- **`DeepSeekLlmClient.chatWithTools`** — after receiving the response, read `response.usage.prompt_tokens` and log it alongside `conversationId`. Extend the internal response parsing to capture the `usage` field; the existing `LlmResponse` union does not need to change (the number is only consumed for logging).
- **New: prompt-budget utility (pure function)** — a small function exported from a shared location in the agent module that takes a string and returns an estimated token count using `Math.ceil(text.length / 1.5)`. Also exports the two threshold constants (`PROMPT_BUDGET_WARN = 4000`, `PROMPT_BUDGET_ERROR = 5000`). Pure, no dependencies. This is the single place to change the heuristic or thresholds.
- **New: orphan Tool check (pure function)** — a function that takes `toolNames: string[]` and `skills: AgentSkill[]` and returns the list of Tool names that appear in `toolNames` but in no Skill's `tools[]`. Pure, fully testable without NestJS.
- **`AgentModule`** — add an `onModuleInit` hook (or equivalent lifecycle entry point) that runs the orphan check against the injected `AGENT_TOOLS` and `AGENT_SKILLS` arrays. If orphans exist, throw with a message listing the offending Tool names. The module lifecycle will surface this as a boot-time failure.
- **`AgentModule` test (new spec)** — the module-boot smoke test. Uses `Test.createTestingModule({ imports: [AgentModule] }).compile()` and asserts that `AgentService`, `OntologySdkService`, `ConfirmationGate`, `ConnectorClient`, and all 13 Tool classes resolve from the container. No behavior assertion — the test's value is that it exercises DI graph construction.

### Architectural decisions (confirmed by ADR-0010)

- **Prompt budget is soft, not hard.** Logging only; the request proceeds regardless of budget state.
- **Token estimation is approximate on purpose.** `chars / 1.5` is a compromise between accuracy and zero-dependency simplicity. Real truth comes from `response.usage.prompt_tokens`, which is logged separately.
- **Orphan check is hard-failing.** An orphaned Tool is a configuration bug (the Tool is invisible to the LLM), which is a feature loss. This is treated differently from a prompt overrun (graceful degradation).
- **Monitoring uses NestJS's built-in `Logger`.** No pino, no winston, no log aggregation wiring today. Structured JSON logging is deferred until a downstream log system exists.
- **Tool scoping filter stays in place** as established in ADR-0010 and the existing `getScopedToolNames` code — the orphan check augments it but does not replace it.
- **The 5000-token budget applies to the system prompt only** (base prompt + active Skills' `systemPrompt()` output). Tool definitions, conversation history, and tool-result payloads are out of scope.

### Interfaces and contracts

- **Prompt-budget utility interface:** a single pure function, `estimateTokens(text: string): number`, plus two exported constants for thresholds. No class, no DI registration.
- **Orphan-check utility interface:** a single pure function, `findOrphanedTools(toolNames: string[], skills: AgentSkill[]): string[]`. Returns empty array when no orphans exist.
- **Log format:** NestJS `Logger` default format. Log context is the class name (`AgentService`, `DeepSeekLlmClient`). The first argument to `logger.warn/error/log` includes the `conversationId` when available.
- **No changes to public REST/SSE contracts.** This PRD is entirely internal.
- **No changes to `LlmClient` interface.** `DeepSeekLlmClient.chatWithTools` internally reads `usage.prompt_tokens` without surfacing it to callers.

## Testing Decisions

A good test here asserts observable behavior: logs are produced at correct thresholds, boot fails with a clear message for the right inputs, the DI container resolves. Tests do **not** assert on internal state (e.g. "the private `threshold` field is 5000") — the thresholds are constants and can be verified by the log-emission tests.

### Modules to test

- **Prompt-budget utility** — pure function, fully isolated. Tests: estimates scale with length; returns a non-negative integer; threshold constants have the expected values.
- **Orphan-check utility** — pure function, fully isolated. Tests: returns empty when every Tool is declared by at least one Skill; returns the missing Tool names when orphans exist; handles the "no Skills registered" edge case.
- **`AgentService` prompt budget logging** — extend the existing `agent.service.spec.ts` with a test that injects a mock Skill whose `systemPrompt()` exceeds the warn threshold and a mock `Logger` (or spies on the real one), verifies the warn call was made with the expected shape (contains `conversationId`, contains a number above 4000). Same structure for the error threshold.
- **`DeepSeekLlmClient` prompt_tokens logging** — extend the existing `deepseek-llm-client.spec.ts` with a test that mocks a response containing `usage.prompt_tokens` and asserts the logger was called with the number.
- **`AgentModule` orphan check** — a new test that constructs a test module with a Tool registered but not declared by any Skill, asserts that module compilation throws with a message including the Tool name. A second test covers the happy path — the real module with all 13 Tools and 3 Skills — and asserts no error.
- **`AgentModule` boot smoke test** — the DI-resolution test described above. One test, one assertion per provider that needs to resolve. Fast, cheap, runs every CI.

### Prior art

- `apps/core-api/src/modules/agent/agent.service.spec.ts` — mocks `LlmClient` via interface, tests the agent loop's observable behavior. Same pattern for budget-logging tests.
- `apps/core-api/src/modules/agent/llm/deepseek-llm-client.spec.ts` — mocks `global.fetch` to test request/response shape. Same pattern for the `usage`-logging test.
- `apps/core-api/src/modules/agent/conversation/__tests__/conversation.spec.ts` — a service tested through its public interface with a mocked Prisma. Similar approach for the orphan-check utility tests.
- No existing module-boot smoke test in the repo today. This PRD introduces the first instance.

## Out of Scope

- **Replacing `chars / 1.5` with a real tokenizer.** Rejected in ADR-0010; revisit only if estimation error becomes operationally material.
- **Automatic two-stage Skill activation when budget is exceeded.** Rejected in ADR-0010; a future ADR will design the two-stage protocol when monitoring alerts fire.
- **Hard-failing on prompt overrun.** Explicitly rejected in ADR-0010.
- **Conversation history compression.** Mentioned in ADR-0008 but a separate concern — history length has its own budget and its own compression strategy, and is not addressed here.
- **Tool-definition size monitoring.** Today the 13 Tools consume ~1780 tokens, which is part of every LLM call but outside the 5000-token system-prompt budget. Tracking this is deferred.
- **Log transport changes (pino, winston, structured JSON).** Stay on NestJS's built-in `Logger`. Defer until a log aggregator is wired.
- **Alerting / metrics backend.** Logs are the only output channel. No Prometheus, no Datadog, no pager rules.
- **Retroactive log analysis tooling.** Operators will grep. A dashboard is not in scope.

## Further Notes

- The ConfirmationGate DI bug (story #8) is what elevated the module-boot smoke test from "nice to have" to "in scope." The bug took ~10 minutes to diagnose in production but would have taken 3 seconds in CI. The cost-to-value ratio for this one test is extreme.
- The orphan check complements — not replaces — the Tool scoping filter in `AgentService.getScopedToolNames`. The filter decides "which Tools get sent to the LLM this turn." The orphan check decides "are any registered Tools permanently excluded by misconfiguration." One runs every turn, the other runs once at boot.
- `conversationId` is threaded from `AgentController` into `AgentService.run`, but `buildSystemPrompt` is called from inside `executeLoop` which already has `input.conversationId`. No signature change is needed upstream.
- The warn/error thresholds (4000 / 5000) are exposed as exported constants so tests can reference them by name rather than hardcoding the numbers. When thresholds move, only the constants change.
