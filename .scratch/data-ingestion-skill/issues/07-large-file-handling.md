---
status: ready-for-agent
type: AFK
category: enhancement
created: 2026-05-05
---

# Large file handling: batch import + progress + size limit

## Parent

[Data Ingestion Skill PRD](../PRD.md)

## What to build

Handle large files gracefully: enforce 50MB upload limit with clear error message, process imports in batches of 1000 rows with SSE progress events, and suggest database connection for files exceeding the limit.

## Acceptance criteria

- [ ] Files >50MB are rejected at upload with error: `{ error: "文件超过50MB限制，建议使用数据库连接方式导入" }`
- [ ] Import processes rows in batches of 1000, yielding progress events between batches
- [ ] SSE stream includes progress events: `{ type: "tool_result", name: "import_data", data: { progress: { imported: 2000, total: 5000 } } }`
- [ ] Frontend /chat page displays progress (e.g. "已导入 2000/5000 条")
- [ ] Memory usage stays stable during large imports (no loading entire file into memory at once)
- [ ] A 10,000-row Excel file imports successfully without timeout

## Blocked by

- [01-tracer-bullet-excel-import](./01-tracer-bullet-excel-import.md)
