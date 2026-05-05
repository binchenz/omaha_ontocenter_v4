---
status: ready-for-agent
category: enhancement
type: AFK
created: 2026-05-05
---

# Multi-turn conversation with context compression

## Parent

[Agent-First Platform PRD](../PRD.md)

## What to build

Enable multi-turn conversations where the agent remembers previous context. When a user sends a follow-up message with a `conversationId`, the agent loads conversation history, compresses older turns, and includes them in the LLM context so the agent can understand references like "按销售额排序" (sort by revenue) after a previous query.

This slice adds:
- `ConversationService.getHistory()` loading previous turns
- `ConversationService.compressHistory()` — recent 3 turns kept complete, older turns truncated to role + short content summary
- Agent loop assembles compressed history + current message before calling LLM
- `ChatDto` accepts optional `conversationId` to continue existing conversations
- Multiple turns persisted in sequence within one conversation

## Acceptance criteria

- [ ] Sending `{ "conversationId": "<id>", "message": "按销售额排序" }` after a previous query returns results sorted by the referenced field
- [ ] Conversation with 5+ turns still works — older turns are compressed, LLM context stays within bounds
- [ ] Each turn is persisted with correct `conversationId` and sequential `createdAt`
- [ ] A new conversation is created if no `conversationId` is provided (backward compat with slice 01)
- [ ] Compressed history preserves enough context for the LLM to understand follow-up references

## Blocked by

- [01-tracer-bullet-single-turn-query](./01-tracer-bullet-single-turn-query.md)
