---
status: ready-for-agent
type: AFK
category: enhancement
created: 2026-05-05
---

# Conversation history sidebar

## Parent

[Frontend Chat Polish PRD](../PRD.md)

## What to build

Show recent conversations in the left sidebar under "AI 对话". Add `GET /agent/conversations` backend endpoint. Clicking a conversation loads its history. "新对话" button starts fresh.

## Acceptance criteria

- [ ] `GET /agent/conversations` returns user's conversations (id, title, updatedAt) sorted by updatedAt desc
- [ ] Conversation title is auto-generated from first user message (truncated to 20 chars)
- [ ] Sidebar shows up to 10 recent conversations under "AI 对话" nav item
- [ ] Clicking a conversation loads its message history into the chat
- [ ] "新对话" button clears current conversation and starts fresh
- [ ] Current conversation is highlighted in the sidebar
- [ ] Right panel resets when switching conversations

## Blocked by

- [01-markdown-rendering](./01-markdown-rendering.md)
