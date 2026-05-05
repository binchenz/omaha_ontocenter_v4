---
status: ready-for-agent
category: enhancement
type: AFK
created: 2026-05-05
---

# Tracer bullet: single-turn agent query via SSE

## Parent

[Agent-First Platform PRD](../PRD.md)

## What to build

The thinnest possible end-to-end path through the new agent architecture. A user sends a natural language message to `POST /agent/chat`, the agent activates the query skill, calls the `query_objects` tool via LLM function calling, and streams results back as SSE events. One conversation turn is persisted.

This slice introduces all foundational pieces at their minimum viable form:
- Extended `LlmClient` interface with `chatWithTools()` method
- `DeepSeekLlmClient` implementation using OpenAI-compatible function calling
- `OntologySdkService` wrapping QueryService + OntologyService
- `query_objects` tool with JSON Schema definition
- `AgentService` with single-iteration tool loop
- `AgentController` with SSE streaming via `POST /agent/chat`
- `ConversationService` creating a conversation and persisting the turn
- `AgentModule` registered in AppModule (alongside existing NlQueryModule for now)

## Acceptance criteria

- [ ] `POST /agent/chat` with `{ "message": "找出华东地区的A级客户" }` returns an SSE stream
- [ ] SSE stream contains events: `tool_call` (showing query_objects invocation), `tool_result` (with query data), `text` (agent's natural language summary), `done` (with conversationId)
- [ ] Query results match what `POST /query/nl` would return for the same question
- [ ] A `Conversation` row is created in the database with the correct tenantId and userId
- [ ] A `ConversationTurn` row is persisted with role, content, toolCalls, and toolResults
- [ ] `pnpm --filter @omaha/core-api build` compiles without errors
- [ ] LLM client correctly sends `tools` array in DeepSeek API request and parses `tool_calls` from response

## Blocked by

None — can start immediately
