---
status: ready-for-agent
type: AFK
category: enhancement
created: 2026-05-05
---

# Manual refresh (re-import with upsert)

## Parent

[Data Ingestion Skill PRD](../PRD.md)

## What to build

Enable users to refresh previously imported data by saying "刷新订单数据". The agent identifies the source (file or database Connector), re-reads the data, and upserts Object Instances by externalId — updating existing rows and adding new ones without creating duplicates.

## Acceptance criteria

- [ ] User says "刷新订单数据", agent identifies the Object Type and its import source
- [ ] For file-based imports: agent asks user to re-upload the file (or uses the stored fileId if still available)
- [ ] For database imports: agent re-connects and re-pulls from the same table
- [ ] Upsert by externalId: existing rows are updated, new rows are created, missing rows are NOT deleted (no soft-delete detection in MVP)
- [ ] Agent reports results: "刷新完成：更新 180 条，新增 12 条"
- [ ] If externalId was row-number (fallback), agent warns that refresh will replace all data instead of upsert

## Blocked by

- [01-tracer-bullet-excel-import](./01-tracer-bullet-excel-import.md)
