---
status: ready-for-agent
type: AFK
category: enhancement
created: 2026-05-05
---

# Markdown rendering in chat messages

## Parent

[Frontend Chat Polish PRD](../PRD.md)

## What to build

Install react-markdown + remark-gfm in the web package. Create a `<Markdown>` component with Tailwind-styled overrides for tables, code blocks, headings, bold, and lists. Apply it to all assistant message bubbles in /chat.

## Acceptance criteria

- [ ] Agent responses with markdown tables render as styled HTML tables
- [ ] Bold text, headings, and lists render correctly
- [ ] Code blocks have syntax highlighting background
- [ ] Tables have borders, padding, and alternating row colors
- [ ] No XSS vulnerability (react-markdown is safe by default)
- [ ] Existing chat functionality unchanged

## Blocked by

None — can start immediately
