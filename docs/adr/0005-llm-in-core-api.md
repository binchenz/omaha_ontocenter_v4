# LLM Lives in core-api as a Plan Generator, Not in agent-worker

The MVP places LLM-driven natural language understanding inside `core-api` as a new `llm` module that generates Query Plans and Action inputs via single-shot function calling. The frontend submits raw NL input to `POST /nl/query` and receives **either** a Query Plan (for the user to review and execute) **or** a clarifying question (one round max). Plans are always executed via the existing `POST /query/objects` endpoint — the same path a hand-written Plan takes — so all permission, ontology, and audit machinery applies uniformly. `agent-worker` is reserved for scheduled sync jobs and long-running V1.1 features (multi-turn agent loops, batch summaries); it is **not** on the MVP NL path.

## Why

PRD §12.2's AI guardrails (no direct DB access, no permission bypass, no fabricated results) require all LLM ↔ data interaction to flow through the same back-end query path used by humans. Putting the LLM in the frontend would make this guarantee structurally impossible. The PRD §9 example query is a single-prompt task that current LLMs handle in one function call, so a queue-backed worker would only add latency and failure modes without buying capability. Keeping the NL → Plan and Plan → Result steps separate (PRD §6.2) is what gives the user a chance to inspect and edit before any data is read.

## Consequences

- **Two-step UX is mandatory**: NL module returns a Plan; user clicks confirm; query runs. The NL module **never** executes the query itself. This is what makes §6.2 ("查询计划预览") true.
- **Permission and ontology validation are the only safety net** against prompt-injected Plans. The compiler from ADR 0001 must reject Plans referencing nonexistent fields, relations, or Derived Properties — there is no second check.
- **Provider config is per-tenant** (`tenants.settings.llm.{provider, apiKey, model, allowExternal}`); prompt templates are **not** tenant-configurable in MVP — they live in code. Opening prompt customization later requires a versioned prompt registry (deferred).
- **Failure modes are loud**: 10s hard timeout, no retry, returns a structured error to the frontend so the user can fall back to manual Query Plan editing. PRD §10.3 ("AI 解析失败时允许用户手动修改查询条件") is satisfied by the same UI rendering the empty Plan editor.
- **Audit captures the full chain**: `{original_input, llm_model, prompt_version, generated_plan, clarifying_history, source: 'ai_chat'}`. When the same Plan is later executed, audit links the execution row to the NL row.
- **`agent-worker` retains its role** for scheduled connectors (PRD §7.1) and V1.1 multi-turn agent loops. The split is deliberate: synchronous NL→Plan stays in the request path; asynchronous, retriable, long-running work goes to the worker. Conversation/skill schemas (already seeded in Plan 3) remain in place to support the V1.1 path without migration.
- **Clarifying questions are bounded**: MVP allows at most one round, returned as a structured `{ question, options[] }` so the frontend can render a single-select. Open-ended multi-turn dialogue is V1.1.
