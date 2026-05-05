# Agent-First Architecture: Single Agent + Skill/SDK/Tool

The platform's primary user interaction model is a conversational AI agent, not REST forms. Target users (Chinese SMBs without dedicated data engineers) complete all operations — data ingestion, ontology design, querying, action execution — through natural language dialogue with a single agent. Existing REST APIs remain as a parallel access path for structured UI (ontology browsing, result tables), but the agent is the primary entry point.

## Why

Target customers lack technical staff to operate traditional BI/data-warehouse configuration UIs. The only genuinely low-barrier interaction mode is natural language. This makes the agent not an assistant bolted onto a CRUD app, but the product itself — similar to Palantir AIP's model where the agent operates against the ontology via typed SDK calls.

## Considered Options

**Single Agent vs Multi-Agent routing:** A router agent dispatching to sub-agents (data-ingestion agent, query agent, action agent) was considered. Rejected because SMB operations are frequently cross-domain ("import this Excel then query the A-grade customers in it") — splitting agents introduces routing errors and context loss. Instead, a single agent with dynamically activated Skills narrows the tool set per intent without losing conversational continuity.

**SSE vs WebSocket for streaming:** WebSocket offers bidirectional communication (user can interrupt mid-stream), but adds reconnection complexity and infrastructure requirements. SSE is HTTP-native, NestJS-supported, and sufficient — cancellation is handled via a separate `POST /agent/cancel` endpoint.

**Independent nl-query endpoint vs merged into agent:** Keeping `POST /query/nl` as a standalone endpoint means maintaining two NL paths with diverging prompt logic. Merged: all NL interaction flows through the agent conversation, ensuring consistent context accumulation and a single prompt codebase.

## Consequences

- **Module structure changes.** A new `agent` module becomes the primary entry point, containing: agent loop, SDK (ontology-aware interface layer), tools (atomic operations), and skills (domain knowledge + tool subsets + workflow patterns). The existing `nl-query` module is absorbed into the agent's query skill.
- **Skill/SDK/Tool layering.** Tool = atomic LLM-callable operation. SDK = ontology-aware typed interface (agent calls SDK, SDK calls OntologyService/QueryService/etc). Skill = domain capability package (prompt fragment + relevant tools + workflow guidance). Agent auto-activates skills based on user intent.
- **LLM protocol is OpenAI function calling.** Tools are defined as JSON Schema; LLM returns `tool_calls`; agent loop executes and feeds results back. DeepSeek supports this natively; switching to Claude/GPT requires zero protocol changes.
- **Communication is SSE.** `POST /agent/chat` returns an SSE stream with typed events (`text`, `tool_call`, `confirmation_request`, `result`, `error`). Frontend renders different components per event type.
- **Risk-based confirmation.** Read operations execute without confirmation. Write operations (create type, import data, execute action) pause for user approval before committing.
- **Conversation state is fully persisted, dynamically compressed for LLM.** All turns stored in `Conversation` + `ConversationTurn` tables (complete messages, tool calls, results). When feeding to LLM: recent 2-3 turns are complete; older turns are summarized. Supports audit replay and long conversations.
- **Single process.** Agent loop, SDK, and all services run in the same `core-api` NestJS process. No separate agent-worker for the conversational path. The `agent-worker` package is deleted.
- **Skills are code-defined.** Each skill is a TypeScript file with prompt, tool list, and workflow logic. No database-driven skill configuration in MVP — SMB users won't write prompts.
- **REST APIs remain.** Existing controllers (ontology, query, connector, mapping) stay as parallel access paths for structured UI pages. Agent and UI are two routes to the same underlying services.
- **Frontend becomes left-conversation + right-panel.** Dialogue on the left drives a dynamic panel on the right (tables, ontology graphs, confirmation cards). No separate "query page" — queries flow through conversation.
- **ADR-0005 is superseded.** The two-step "NL → Plan → user confirms → execute" model described in ADR-0005 is replaced by the agent's risk-based confirmation within the conversation flow. The agent may still show a plan for high-risk operations, but this is a UX choice within the agent skill, not a mandatory architectural step.
- **Layered error handling.** Tool execution failures are fed back to the LLM as error context — the agent can self-heal (adjust parameters, try a different tool). LLM-level failures (timeout, rate limit, invalid response) surface directly to the user as an `error` SSE event. A max loop count of 5 prevents infinite tool-call cycles.
- **Confirmation rejection stays in-flow.** When a user rejects a `confirmation_request`, the rejection (plus any user comment) is fed back to the LLM as a tool result. The agent adapts within the same conversation turn — no need to start over.
- **Skill injection is full for now.** All skill prompts and tools are injected into every LLM call. With 2-3 skills this is negligible token cost. When skill count exceeds 5-6 and prompt length becomes a bottleneck, switch to a two-stage activation (LLM picks skills from a catalog first, then full injection).
- **Frontend transition is incremental.** A new `/chat` page is added as the agent entry point. Existing pages (`/ontology`, `/query`) remain as fallback and validation reference. Once agent capabilities fully cover those workflows, old pages are deprecated.
- **Prompt injection dual protection.** Tool results containing user data are wrapped in boundary markers (`<data>...</data>`) with system prompt instructions to treat enclosed content as data, not instructions. Write operations additionally require human confirmation — even if the LLM is injected, it cannot bypass the confirmation gate.
- **Audit is dual-track, linked.** `AuditLog` continues recording data access facts (who accessed what, with what permission filter). `Conversation` records intent and agent behavior. A `conversationId` field on `AuditLog` links the two, enabling both "what data was accessed" and "why was it accessed" queries.
