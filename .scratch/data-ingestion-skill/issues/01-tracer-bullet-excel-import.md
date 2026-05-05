---
status: ready-for-agent
type: AFK
category: enhancement
created: 2026-05-05
---

# Tracer bullet: upload Excel → infer schema → confirm → import

## Parent

[Data Ingestion Skill PRD](../PRD.md)

## What to build

The thinnest end-to-end path through the data ingestion skill. A user uploads an Excel file via `POST /files/upload`, then sends a chat message referencing the fileId. The agent parses the file, infers column types (code) + semantic enrichment (LLM: Object Type name, label column, externalId column, filterable/sortable flags), presents a confirmation plan, and upon approval creates the Object Type and imports all rows as Object Instances.

This slice introduces:
- `POST /files/upload` endpoint (multipart, local filesystem storage, .xlsx only for now)
- `parse_file` tool — reads Excel via `exceljs`, samples values for type inference, returns columns + types + sample rows
- `create_object_type` tool — calls OntologyService.createObjectType() (requiresConfirmation: true)
- `import_data` tool — batch creates Object Instances via Prisma (requiresConfirmation: true)
- `DataIngestionSkill` — system prompt with inference rules, exposes all ingestion tools
- `ChatDto` extended to accept optional `fileId`
- Frontend `/chat` page: file upload button that calls `/files/upload` then sends message with fileId

## Acceptance criteria

- [ ] `POST /files/upload` accepts .xlsx file ≤50MB, stores locally, returns `{ fileId, filename, size }`
- [ ] Agent parses uploaded Excel and returns column names + inferred types in a tool_result event
- [ ] Agent presents a confirmation_request with Object Type name, properties (with types and flags), externalId column, label column
- [ ] After user confirms, Object Type is created in the database with correct properties
- [ ] Object Instances are created with correct properties, externalId, and label
- [ ] Import count matches row count in the Excel file
- [ ] `pnpm --filter @omaha/core-api build` compiles without errors
- [ ] Verifiable with curl: upload file → chat with fileId → SSE stream shows full flow

## Blocked by

None — can start immediately
