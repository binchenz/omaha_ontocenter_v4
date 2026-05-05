---
status: ready-for-agent
type: AFK
category: enhancement
created: 2026-05-05
---

# Database connection: guided setup + test

## Parent

[Data Ingestion Skill PRD](../PRD.md)

## What to build

Enable users to connect their MySQL or PostgreSQL database through conversation. The agent guides them step-by-step (host → port → user → password → database), testing connectivity at each meaningful step. On success, a Connector is created with encrypted credentials.

This slice introduces:
- `create_connector` tool — stores connection config with AES-256 encrypted password (requiresConfirmation: true)
- `test_db_connection` tool — attempts connection with provided params, returns success/error
- DataIngestionSkill prompt additions for the database connection workflow
- Encryption utility for credential storage (reads key from `CONNECTOR_ENCRYPTION_KEY` env var)

## Acceptance criteria

- [ ] Agent asks for connection details step-by-step when user says "帮我连接数据库"
- [ ] `test_db_connection` tool connects to MySQL and PostgreSQL, returns success or specific error message
- [ ] On connection failure, agent reports the error and asks user to correct (e.g. "连接失败：密码错误，请重新输入密码")
- [ ] `create_connector` stores config in Connector table with password encrypted
- [ ] Connector config can be decrypted and used for subsequent operations
- [ ] Agent confirms before creating connector ("我准备保存这个数据库连接，确认吗？")
- [ ] Works with the test PostgreSQL instance (localhost:5434)

## Blocked by

- [01-tracer-bullet-excel-import](./01-tracer-bullet-excel-import.md)
