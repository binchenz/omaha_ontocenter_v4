---
status: ready-for-agent
type: AFK
category: enhancement
created: 2026-05-05
---

# Confirmation card interaction

## Parent

[Frontend Chat Polish PRD](../PRD.md)

## What to build

When the SSE stream emits a `confirmation_request` event, render an interactive card inline in the conversation. The card shows the agent's plan (markdown rendered) with "确认" and "拒绝" buttons. Clicking sends `POST /agent/confirm` and the conversation continues.

Backend: add `POST /agent/confirm` endpoint and `GET /agent/conversations` endpoint.

## Acceptance criteria

- [ ] `confirmation_request` events render as a styled card in the message list
- [ ] Card content is markdown-rendered (tables, bold, etc.)
- [ ] "确认" button sends `{ conversationId, confirmed: true }` to `POST /agent/confirm`
- [ ] "拒绝" button reveals a text input for comment, then sends `{ conversationId, confirmed: false, comment }`
- [ ] After clicking, buttons become disabled showing "已确认" or "已拒绝"
- [ ] Agent responds after confirmation (new SSE stream or continuation)
- [ ] Backend `POST /agent/confirm` endpoint exists and processes the request

## Blocked by

- [01-markdown-rendering](./01-markdown-rendering.md)
