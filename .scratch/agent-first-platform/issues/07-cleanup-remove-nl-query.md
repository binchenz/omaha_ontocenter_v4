---
status: ready-for-agent
category: enhancement
type: AFK
created: 2026-05-05
---

# Cleanup: remove nl-query, wire audit conversationId

## Parent

[Agent-First Platform PRD](../PRD.md)

## What to build

Remove the now-superseded `nl-query` module and wire up the audit trail link between Conversation and AuditLog. The agent module fully replaces `POST /query/nl` — this slice removes the old code path and ensures all agent-initiated queries are traceable in the audit log.

This slice:
- Deletes `apps/core-api/src/modules/nl-query/` directory entirely
- Removes `NlQueryModule` from `AppModule` imports
- Adds `conversationId?: string` to the `ToolContext` passed to tools
- `query_objects` tool passes `conversationId` through to QueryService
- QueryService includes `conversationId` in AuditLog writes (when present)
- Frontend `/query` page updated: either removed or rewired to use `/agent/chat` (user's choice — the page can stay as a direct REST query interface without NL)
- Frontend `api.ts`: remove `nlQuery` method

## Acceptance criteria

- [ ] `apps/core-api/src/modules/nl-query/` directory no longer exists
- [ ] `NlQueryModule` is not in `AppModule` imports
- [ ] `pnpm --filter @omaha/core-api build` compiles without errors
- [ ] Agent-initiated queries write `conversationId` to the `AuditLog` row
- [ ] AuditLog entries from direct REST queries (no agent) have `conversationId = null` (no regression)
- [ ] Frontend builds without errors after removing nlQuery references
- [ ] No remaining imports or references to `nl-query` module in the codebase

## Blocked by

- [01-tracer-bullet-single-turn-query](./01-tracer-bullet-single-turn-query.md)
- [02-multi-turn-conversation](./02-multi-turn-conversation.md)
- [06-frontend-chat-page](./06-frontend-chat-page.md)
