---
status: ready-for-agent
type: AFK
category: enhancement
created: 2026-05-05
---

# Database import: list tables + preview + import

## Parent

[Data Ingestion Skill PRD](../PRD.md)

## What to build

After a Connector is established, enable the agent to list available tables, preview a table's structure and sample data, then import it using the same schema inference + confirmation + import flow as file uploads.

This slice introduces:
- `list_db_tables` tool — connects to the database, returns table names (filtering system tables)
- `preview_db_table` tool — reads column schema + first N rows from a specified table
- Integration with existing `parse_file` inference logic (reuse type inference + LLM enrichment on the preview result)
- `import_data` tool extended to pull from database (SELECT * with batching)

## Acceptance criteria

- [ ] `list_db_tables` returns business tables, excludes system tables (information_schema, pg_catalog, mysql internal)
- [ ] Agent recommends tables to import based on names ("我看到 customers、orders、products 三张表，要导入哪些？")
- [ ] `preview_db_table` returns column names, types, and 5 sample rows
- [ ] Schema inference works on database table preview (same LLM enrichment as file path)
- [ ] `import_data` can pull rows from database in batches of 1000
- [ ] Full flow works: user says "导入 orders 表" → agent previews → confirms → creates type → imports
- [ ] Works with the test PostgreSQL instance

## Blocked by

- [04-database-connection](./04-database-connection.md)
