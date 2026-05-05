---
status: done
category: enhancement
created: 2026-05-05
---

# PRD: Agent-First Platform — Phase 2 (Agent Module Skeleton)

## Problem Statement

OntoCenter's target customers are Chinese SMBs without dedicated data engineers. The current product exposes REST APIs and form-based UI pages (ontology browser, NL query page) that still require technical understanding to operate effectively. Users must know which Object Type to query, understand filter syntax, and navigate between separate pages for different operations. The natural language query feature (`POST /query/nl`) helps, but it's stateless, single-shot, and limited to querying — it cannot guide users through multi-step workflows like data import or ontology design.

The platform needs to become agent-first: a single conversational AI agent that users interact with in natural language to accomplish all operations — querying data, importing files, designing ontology, and (in future) executing actions. The agent is not an assistant bolted onto a CRUD app; it IS the product.

## Solution

Introduce an `agent` module in `core-api` that implements a conversational AI agent with:

- **SSE streaming** — real-time response delivery via Server-Sent Events
- **Tool calling loop** — LLM decides which operations to perform, executes them, and iterates until the task is complete
- **Skill/SDK/Tool layering** — Skills provide domain knowledge and workflow guidance, SDK provides ontology-aware typed access, Tools are atomic LLM-callable operations
- **Conversation persistence** — multi-turn dialogue with full history storage and dynamic compression
- **Risk-based confirmation** — read operations execute freely, write operations pause for user approval

The existing `nl-query` module is absorbed into the agent's query Skill. Existing REST APIs and UI pages remain as parallel access paths during transition.

## User Stories

1. As a business owner, I want to ask "帮我查一下上个月华东地区的A级客户" in a chat interface, so that I get results without knowing which Object Type or filters to use.
2. As a business owner, I want to follow up with "按销售额排序" in the same conversation, so that the agent remembers my previous query context.
3. As a business owner, I want to see query results displayed in a structured table panel next to the conversation, so that I can read data comfortably while continuing to chat.
4. As a business owner, I want the agent to show me "正在查询客户数据..." progress indicators, so that I know the system is working during longer operations.
5. As a business owner, I want to see what the agent understood ("AI 理解为: 类型=客户, 过滤=地区=华东 AND 等级=A"), so that I can verify correctness before trusting the results.
6. As a business owner, I want to say "不对，我要的是华南地区" to correct the agent, so that I don't need to retype the entire query.
7. As a business owner, I want the agent to ask me for confirmation before creating a new Object Type ("我准备创建'供应商'类型，包含以下字段... 确认吗？"), so that write operations don't happen without my approval.
8. As a business owner, I want to reject a confirmation and explain why ("不是供应商，是分销商"), so that the agent adjusts its plan without me starting over.
9. As a business owner, I want to resume a previous conversation by selecting it from a list, so that I can continue multi-session workflows.
10. As a business owner, I want the agent to recover gracefully when a query fails ("查询参数有误，我换个方式试试"), so that I don't see raw error messages.
11. As a business owner, I want to use the existing ontology browser page to inspect my data model, so that I have a structured view when the chat interface isn't ideal for browsing.
12. As a business owner, I want the agent to know my entire ontology schema (all types, properties, relationships), so that it can answer questions about any part of my data without me specifying the type.
13. As a business owner, I want the agent to handle ambiguous requests ("帮我看看最近的数据") by asking a clarifying question rather than guessing wrong, so that results are accurate.
14. As a developer, I want to add new Tools by implementing a simple interface and registering them, so that extending agent capabilities is straightforward.
15. As a developer, I want to add new Skills by creating a TypeScript file with prompt + tool list, so that new domain capabilities don't require architectural changes.
16. As a developer, I want the LLM client to be swappable (DeepSeek today, Claude/GPT tomorrow), so that we're not locked into one provider.
17. As a developer, I want conversation turns to be fully persisted with tool calls and results, so that I can debug agent behavior by replaying conversations.
18. As a security auditor, I want all data access through the agent to be recorded in AuditLog with a conversationId link, so that I can trace why specific data was accessed.
19. As a security auditor, I want user data in tool results to be boundary-marked before feeding to the LLM, so that prompt injection from data content is mitigated.

## Implementation Decisions

### Architecture (per ADR-0008)

- **Single Agent + Skill/SDK/Tool layering** in a single `core-api` process. No separate agent-worker.
- **Agent module** becomes the primary conversational entry point. Existing REST controllers remain as parallel access paths.
- **nl-query module is deleted** — its prompt logic migrates to the query Skill, its LLM client is extended and moved to the agent module.

### Module Design

Six internal modules within `agent/`:

1. **LLM Client** — interface with `chat()` (backward compat) and `chatWithTools()` (new). Returns discriminated union: `{ type: 'text' }` or `{ type: 'tool_calls' }`. DeepSeek implementation uses OpenAI-compatible function calling protocol.

2. **Tool Layer** — `AgentTool` interface: `{ name, description, parameters (JSON Schema), requiresConfirmation, execute(args, context) }`. ToolRegistry collects all tools and provides definitions for LLM. Initial tools: `query_objects`, `get_ontology_schema`.

3. **SDK Layer** — `OntologySdkService` wraps OntologyService + QueryService. Methods: `getSchema(tenantId)`, `queryObjects(user, request)`. Thin pass-through now; future home for caching and permission pre-checks.

4. **Skill Layer** — `AgentSkill` interface: `{ name, description, tools[], systemPrompt(context) }`. SkillRegistry loads all skills. Initial skill: `query` (migrated from nl-query). All skills injected into every LLM call (full injection strategy).

5. **Agent Loop** — `AgentService.run(user, dto)` returns `AsyncGenerator<AgentEvent>`. Loop: load history → assemble prompt → call LLM → if tool_calls: execute tools (with confirmation gate for write ops) → feed results back → repeat (max 5 iterations) → if text: yield to stream → persist turns.

6. **Conversation Service** — CRUD on existing `Conversation` + `ConversationTurn` tables. `compressHistory()`: recent 3 turns complete, older turns truncated/summarized.

### API Contract

- `POST /agent/chat` — SSE stream. Request body: `{ conversationId?: string, message: string }`. Response: SSE events with types: `text`, `tool_call`, `tool_result`, `confirmation_request`, `error`, `done`.
- `POST /agent/confirm` — User confirms/rejects a pending confirmation. Body: `{ conversationId: string, confirmed: boolean, comment?: string }`.

### SSE Event Schema

```
{ type: 'text', content: string }
{ type: 'tool_call', name: string, args: object }
{ type: 'tool_result', name: string, data: object }
{ type: 'confirmation_request', id: string, toolName: string, args: object, message: string }
{ type: 'error', message: string }
{ type: 'done', conversationId: string }
```

### Error Handling

- Tool execution failure → error fed back to LLM as context, LLM self-heals (retry with different params or report to user)
- LLM failure (timeout/rate-limit/invalid response) → `error` event sent to frontend directly
- Max 5 tool-call iterations per user message to prevent infinite loops

### Security

- Prompt injection mitigation: tool results wrapped in `<data>...</data>` boundary markers; system prompt instructs LLM to treat enclosed content as data
- Write operations require `confirmation_request` → user approval before execution
- All queries still pass through PermissionResolver (via QueryService) — agent cannot bypass row-level security

### Audit

- QueryService continues writing AuditLog entries (unchanged)
- AuditLog gains a `conversationId` field linking to the originating conversation
- Conversation table stores full turn history for behavioral audit

### Frontend (this phase)

- Add `/chat` page with SSE client, message list, and right-side result panel
- Keep existing `/ontology` and `/query` pages unchanged

## Testing Decisions

Good tests for this feature verify external behavior through module interfaces, not internal wiring. A test should break only when the module's contract changes, not when implementation details shift.

### Modules to test

1. **LLM Client** — unit tests with HTTP mocks. Verify: correct request format for tool calling, proper parsing of tool_calls response, error handling for timeouts and malformed responses.

2. **Agent Loop** — integration tests with mocked LLM client + real tools (or mocked SDK). Verify: tool dispatch loop terminates, confirmation gating pauses execution, error recovery feeds back to LLM, max-loop guard triggers.

3. **Individual Tools** — unit tests with mocked SDK. Verify: correct argument validation, proper SDK method delegation, error formatting for LLM consumption.

4. **Conversation Service** — integration tests against real Prisma/DB. Verify: turn persistence, history retrieval ordering, compression logic (recent turns complete, old turns truncated).

### Prior art

- `packages/dsl/src/__tests__/` — unit tests for pure functions (parser, compiler, analyzer)
- `apps/core-api/test/` — e2e tests using NestJS testing utilities with real DB

## Out of Scope

- **Data ingestion skill** — future phase; requires Connector/Mapping/Sync implementation
- **Ontology design skill** — future phase; agent creating/modifying Object Types
- **Action skill** — long-term; requires Action module implementation (ADR-0004)
- **Sandbox/scenario model** — Palantir-style isolated write environments; deferred until Action support exists
- **LLM-generated conversation summaries** — first version uses simple truncation for history compression
- **Voice input** — natural language via text only
- **Multi-user collaboration** — one user per conversation
- **Streaming token-by-token text** — first version streams complete text chunks, not individual tokens

## Further Notes

- This is Phase 2 of the architecture refactoring. Phase 1 (documentation cleanup, ADR updates, dead code removal) is complete.
- Phase 3 will add the data ingestion skill (upload → infer schema → confirm → map → sync).
- Phase 4 will rebuild the frontend into the full left-chat + right-panel layout.
- The `POST /query/nl` endpoint will stop working after this phase. Frontend must be updated to use `/agent/chat` for NL queries.
- DeepSeek's function calling support uses the OpenAI-compatible format (`tools` array in request, `tool_calls` in response). This is verified working with `deepseek-chat` model.
