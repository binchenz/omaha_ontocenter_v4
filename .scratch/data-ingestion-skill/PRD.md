---
status: needs-triage
created: 2026-05-05
---

# PRD: Data Ingestion Skill

## Problem Statement

OntoCenter 的目标用户（中国中小企业）的数据存在 Excel 表格和简单的 MySQL/PostgreSQL 数据库中。当前系统虽然有 Object Type 和 Object Instance 的存储能力，但用户无法通过对话完成数据导入——他们需要手动定义 Object Type 的属性、配置 Mapping、执行 Sync Job。这对没有技术团队的中小企业来说是不可逾越的门槛。

## Solution

实现一个 Data Ingestion Skill，让用户通过 AI 对话完成完整的数据接入流程：上传文件（或连接数据库）→ 自动推断 schema → 用户确认 → 创建 Object Type → 导入数据。整个过程用户只需要确认一次。

## User Stories

1. As a business owner, I want to upload an Excel file and say "帮我导入这个文件", so that my data becomes queryable without any technical configuration.
2. As a business owner, I want the agent to automatically infer column types (string, number, date) from my data, so that I don't need to manually define each property.
3. As a business owner, I want the agent to suggest a Chinese name for the Object Type (e.g. "客户" not "customer"), so that the ontology is readable for my team.
4. As a business owner, I want the agent to detect that my "customer_id" column refers to an existing Customer type, so that relationships are established automatically.
5. As a business owner, I want to see a confirmation plan ("我准备创建'订单'类型，包含以下字段...，关联到'客户'类型") before anything is created, so that I can verify correctness.
6. As a business owner, I want to reject or modify the plan ("不是关联到客户，那列是收件人名字"), so that mistakes are caught before import.
7. As a business owner, I want to see import progress ("已导入 500/2000 条"), so that I know the system is working on large files.
8. As a business owner, I want to connect my MySQL database and say "帮我把 orders 表导进来", so that I can query live business data.
9. As a business owner, I want the agent to guide me step-by-step through database connection setup ("请告诉我数据库地址"), so that I don't need to know the technical format.
10. As a business owner, I want the agent to test the connection at each step ("连接成功！"), so that I know immediately if something is wrong.
11. As a business owner, I want the agent to list available tables and recommend which ones to import, so that I don't need to remember table names.
12. As a business owner, I want to say "刷新一下订单数据" to re-import from the same source, so that my queryable data stays up to date.
13. As a business owner, I want the agent to identify a unique ID column (like "订单编号") for upsert, so that refreshing doesn't create duplicates.
14. As a business owner, I want the agent to choose a display label column (like "客户名称"), so that query results show meaningful names.
15. As a business owner, I want to upload a CSV file exported from another system, so that I'm not limited to Excel format.
16. As a business owner, I want a clear error message if my file is too large ("文件超过50MB，建议使用数据库连接方式"), so that I know what to do next.
17. As a developer, I want to add new file format parsers by implementing a simple interface, so that future formats (JSON, Parquet) are easy to add.
18. As a developer, I want database credentials stored encrypted, so that connection security is maintained.

## Implementation Decisions

### Architecture (per ADR-0009)

- **Independent file upload endpoint**: `POST /files/upload` (multipart), returns `{ fileId }`. Files stored on local filesystem, 50MB limit.
- **Hybrid schema inference**: Code detects types (string/number/date/boolean by sampling values), LLM enriches semantics (naming, relationships, filterable/sortable flags).
- **One confirmation for the full plan**: Object Type definition + relationship candidates + externalId + label + import action — all in one confirmation_request.
- **Batch import**: 1000 rows per batch, progress reported via SSE events.
- **Manual refresh via conversation**: User says "刷新", agent re-pulls and upserts by externalId.

### New Tools (7)

| Tool | Purpose | Confirmation |
|------|---------|-------------|
| `parse_file` | Parse uploaded CSV/Excel, return columns + types + sample rows | No |
| `test_db_connection` | Test database connectivity | No |
| `list_db_tables` | List tables in connected database (filter system tables) | No |
| `preview_db_table` | Read table schema + sample rows | No |
| `create_object_type` | Create Object Type with properties and relationships | **Yes** |
| `import_data` | Import rows as Object Instances (batch, with progress) | **Yes** |
| `create_connector` | Store database connection config (encrypted) | **Yes** |

### DataIngestionSkill

System prompt includes:
- Complete workflow steps (file vs database paths)
- Type inference rules (numeric → number, ISO date patterns → date, etc.)
- Relationship detection rules (column name matches existing Object Type name/label + `_id`/`_name` suffix)
- Filterable/sortable heuristics (string with low cardinality → filterable, date → filterable + sortable, number → filterable)
- externalId selection rules (unique column, prefer columns named *编号/*号/*id/*code)
- Label selection rules (prefer columns named *名称/*名/*name/*title)

### File Upload Endpoint

```
POST /files/upload
Content-Type: multipart/form-data
Authorization: Bearer <token>

Response: { fileId: string, filename: string, size: number, mimeType: string }
```

Validation: ≤50MB, allowed types: .csv, .xlsx, .xls

### Database Connection Flow

```
User: "帮我连接我的MySQL数据库"
Agent: "好的，请告诉我数据库地址（IP或域名）"
User: "192.168.1.100"
Agent: "端口号？MySQL默认是3306"
User: "3306"
Agent: "数据库用户名？"
User: "root"
Agent: "密码？"
User: "xxx"
Agent: "数据库名称？"
User: "my_shop"
Agent: [calls test_db_connection] "连接成功！发现 12 张表。要导入哪些？"
```

### Confirmation Plan Format

```
Agent: 我准备执行以下操作，请确认：

📋 创建对象类型「订单」
  属性：
  - 订单编号 (string) [filterable] ← 唯一标识
  - 下单日期 (date) [filterable, sortable]
  - 总金额 (number) [filterable]
  - 状态 (string) [filterable]
  - 客户名称 (string)
  
  关联关系：
  - → 客户（通过"客户名称"列匹配）
  
  显示名称：订单编号
  
📥 导入数据：共 1,234 条

确认执行？
```

## Testing Decisions

### Modules to test

1. **File parser** — unit tests: CSV parsing, Excel parsing, type inference from sample values. Verify: correct column detection, type inference accuracy for edge cases (phone numbers as string not number, dates in various formats).

2. **Schema inference** — unit tests with mocked LLM: given columns + types + existing ontology, verify LLM receives correct prompt and the response is properly parsed into Object Type definition.

3. **Import tool** — integration test: given a parsed file and Object Type, verify Object Instances are created with correct properties, externalId, label. Verify upsert behavior on re-import.

4. **Database connection** — integration test against real PostgreSQL (test DB already available): connect, list tables, preview table, import rows.

## Out of Scope

- Scheduled/automatic sync (cron-based refresh)
- Incremental sync with watermark (ADR-0006 incremental strategy)
- Data transformation/cleaning during import (column renaming, value mapping, deduplication)
- JSON/Parquet/XML file formats
- Multi-sheet Excel handling (only first sheet in MVP)
- Cloud storage integration (Google Sheets, OneDrive)
- Data validation rules (e.g. "totalAmount must be positive")

## Further Notes

- This is the first "write" skill — it exercises the confirmation flow (issue #04) in production.
- The `create_object_type` tool will call `OntologyService.createObjectType()` and `OntologyService.createRelationship()` — both already implemented.
- The `import_data` tool will use Prisma's `createMany` or batched `upsert` against the `object_instances` table.
- File cleanup: uploaded files are deleted after 24 hours via a simple cleanup script (not a priority for MVP — manual cleanup is fine).
- Database passwords are encrypted at rest using AES-256 with a server-side key from environment variable.
