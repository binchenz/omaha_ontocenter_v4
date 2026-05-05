---
status: ready-for-agent
type: AFK
category: enhancement
created: 2026-05-05
---

# File upload (button + drag-and-drop)

## Parent

[Frontend Chat Polish PRD](../PRD.md)

## What to build

Add file upload capability to /chat: a 📎 button next to the input and drag-and-drop support on the chat area. On file select, upload to `POST /files/upload`, display filename above input, and include fileId when sending the message.

## Acceptance criteria

- [ ] 📎 button visible next to the send button
- [ ] Clicking opens file picker filtered to .xlsx, .xls, .csv
- [ ] Dragging a file over the chat area shows a visual drop indicator
- [ ] Dropping uploads the file and shows filename + size above input
- [ ] User can type an optional message and send (fileId included in request)
- [ ] Files >50MB show client-side error before upload attempt
- [ ] Upload errors display inline (e.g. "不支持的文件格式")
- [ ] User can remove the attached file before sending (X button on filename)

## Blocked by

- [01-markdown-rendering](./01-markdown-rendering.md)
