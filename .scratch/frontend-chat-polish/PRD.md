---
status: needs-triage
created: 2026-05-05
---

# PRD: Frontend Chat Polish

## Problem Statement

/chat 页面已经能和 Agent 对话并展示查询结果，但用户体验存在明显缺陷：Agent 返回的 markdown 表格显示为纯文本、写操作无法确认（confirmation_request 事件没有交互）、无法上传文件（数据接入 skill 的入口缺失）、无法切换历史对话。这些缺陷使得已实现的后端能力（数据接入、本体设计）在前端不可用。

## Solution

完善 /chat 页面的四个核心交互：markdown 渲染、确认卡片、文件上传、对话历史。让用户能完整使用 Agent 的所有能力。

## User Stories

1. As a business owner, I want to see agent responses with formatted tables and bold text, so that query results are readable.
2. As a business owner, I want to see code blocks and lists properly formatted in agent responses, so that structured information is clear.
3. As a business owner, I want to see a confirmation card with "确认" and "拒绝" buttons when the agent proposes a write operation, so that I can approve or reject.
4. As a business owner, I want to add a comment when rejecting ("不是这个类型，我要的是供应商"), so that the agent understands why I rejected.
5. As a business owner, I want the confirmation card to show the full plan in markdown format, so that I can read the details before deciding.
6. As a business owner, I want to click a 📎 button next to the input to select a file for upload, so that I can import data.
7. As a business owner, I want to drag and drop a file onto the chat area to upload it, so that importing is fast.
8. As a business owner, I want to see the filename displayed above the input after selecting a file, so that I know which file will be sent.
9. As a business owner, I want to type an optional message with the file ("这是供应商数据"), so that the agent has context.
10. As a business owner, I want to see upload progress and errors, so that I know if something went wrong.
11. As a business owner, I want to see my recent conversations listed in the sidebar, so that I can return to previous work.
12. As a business owner, I want to click a conversation in the sidebar to load its history, so that I can continue where I left off.
13. As a business owner, I want to start a new conversation by clicking a "新对话" button, so that I can begin fresh.
14. As a business owner, I want conversation titles to be auto-generated from the first message, so that I can identify them in the list.
15. As a business owner, I want the right panel to update when I switch conversations, so that I see the relevant results.

## Implementation Decisions

### Markdown Rendering
- Use `react-markdown` + `remark-gfm` for GFM support (tables, strikethrough, task lists)
- Custom component overrides for `table`, `th`, `td`, `code`, `pre` with Tailwind styling
- Applied to all assistant message bubbles

### Confirmation Card
- Rendered inline in the conversation flow as a special message type
- Shows the agent's confirmation text (markdown rendered) + two buttons: "确认" / "拒绝"
- Reject button reveals a text input for optional comment
- Clicking confirm/reject calls `POST /agent/confirm` with `{ conversationId, confirmed, comment? }`
- After action, buttons become disabled and show the chosen action ("已确认" / "已拒绝")
- Agent continues in the same SSE stream after confirmation (or starts a new stream for rejection response)

### File Upload
- Attachment button (📎) next to the send button in the input bar
- Drag-and-drop zone covering the entire chat area (visual indicator on drag-over)
- On file select/drop: call `POST /files/upload`, show filename + size above input
- On send: include `fileId` in the chat request body
- Accepted formats: .xlsx, .xls, .csv (validated client-side before upload)
- Max 50MB (validated client-side, server also enforces)

### Conversation History
- New API endpoint: `GET /agent/conversations` — returns list of conversations for current user (id, title, updatedAt)
- Title auto-generated: first user message truncated to 20 chars
- Displayed in the left sidebar under the "AI 对话" nav item
- Shows most recent 10 conversations, sorted by updatedAt desc
- Clicking loads history and sets conversationId for subsequent messages
- "新对话" button at top of list clears current conversation

### New Backend Endpoint
- `GET /agent/conversations` — list user's conversations
- `POST /agent/confirm` — confirm/reject a pending operation

## Testing Decisions

Frontend components are primarily visual — unit testing provides low value for MVP. The testable parts are:
- SSE event parsing logic (already tested in agent.service.spec.ts)
- Conversation list API endpoint (integration test against real DB)

No new frontend tests for this phase. Visual verification via dev server.

## Out of Scope

- Mobile responsive design (desktop only for MVP)
- Conversation search/filter
- Conversation deletion
- Message editing/regeneration
- Typing indicators / streaming token-by-token
- Dark mode
- Keyboard shortcuts

## Further Notes

- `POST /agent/confirm` needs to be implemented on the backend — currently the confirmation flow pauses the SSE stream but there's no resume endpoint. The simplest approach: store pending confirmation state in memory (or DB), and when confirm arrives, execute the tool and return the result as a new SSE stream.
- The conversation list endpoint is trivial — query `conversations` table filtered by userId, ordered by updatedAt.
- react-markdown and remark-gfm need to be installed in the web package.
