---
status: ready-for-agent
category: enhancement
type: AFK
created: 2026-05-05
---

# Frontend /chat page with SSE + result panel

## Parent

[Agent-First Platform PRD](../PRD.md)

## What to build

Add a `/chat` page to the Next.js frontend that connects to `POST /agent/chat` via SSE, renders the conversation as a message list on the left, and displays structured results (query tables, ontology info, confirmation cards) in a dynamic right panel. Existing pages (`/ontology`, `/query`) remain unchanged.

This slice adds:
- `/chat` route in the Next.js app router under `(app)` layout
- SSE client utility that connects to `/agent/chat` and parses typed events
- Left panel: message list with user messages and agent responses (text events)
- Right panel: dynamically renders based on event type — `tool_result` with query data shows a table, `confirmation_request` shows a confirm/reject card
- Conversation selector: list of previous conversations, click to continue
- Input bar at the bottom with send button
- Navigation link to `/chat` in the sidebar

## Acceptance criteria

- [ ] User can type a question and see agent responses stream in real-time
- [ ] Query results appear as a formatted table in the right panel
- [ ] `confirmation_request` events render as a card with confirm/reject buttons in the right panel
- [ ] Clicking confirm/reject sends `POST /agent/confirm` and the conversation continues
- [ ] Previous conversations are listed and selectable (loads history, continues with conversationId)
- [ ] `tool_call` events show a loading indicator ("正在查询...")
- [ ] `error` events display an error message in the conversation
- [ ] Existing `/ontology` and `/query` pages still work unchanged
- [ ] Page is responsive and usable on desktop (mobile is out of scope)

## Blocked by

- [01-tracer-bullet-single-turn-query](./01-tracer-bullet-single-turn-query.md)
