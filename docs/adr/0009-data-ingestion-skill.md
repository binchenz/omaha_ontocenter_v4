# Data Ingestion Skill: File + Database, LLM-Assisted Schema Inference

The data ingestion skill enables users to import data through conversation — uploading CSV/Excel files or connecting to MySQL/PostgreSQL databases. Schema inference is hybrid: deterministic code handles type detection, LLM handles semantic enrichment (naming, relationship identification, filterable/sortable recommendations). All write operations (create Object Type, import data, create Connector) require user confirmation via the agent's confirmation flow.

## Why

Target users (Chinese SMBs) store data in Excel spreadsheets and simple MySQL databases. They lack the technical skill to manually define Object Types, configure mappings, and run imports. The agent must handle the entire pipeline through conversation — from "帮我导入这个 Excel" to queryable Object Instances — with minimal user decisions.

## Considered Options

**Schema inference**: Pure code (fast but no semantic understanding) vs pure LLM (semantic but hallucination-prone) vs hybrid. Chose hybrid — code guarantees type correctness, LLM adds naming/relationship/filterable intelligence.

**File upload**: Embedded in chat endpoint (multipart complexity) vs independent upload endpoint. Chose independent `POST /files/upload` — decouples file handling from SSE streaming, allows size validation and format checks before conversation begins.

**Sync strategy**: One-shot import vs full ADR-0006 sync engine. Chose one-shot + manual refresh (user says "刷新数据", agent re-pulls and upserts by externalId). Full scheduled sync deferred — requires cron infrastructure not yet built.

**Database config collection**: Form-based vs conversational. Chose conversational with step-by-step guidance + connection test at each step. Aligns with agent-first product positioning.

## Consequences

- **New endpoint**: `POST /files/upload` accepts multipart file (CSV/Excel), validates size (≤50MB), stores to local filesystem, returns `{ fileId }`. Files are temporary — retained for re-import, cleaned up after configurable TTL.
- **Seven new tools** in the agent module: `parse_file`, `test_db_connection`, `list_db_tables`, `preview_db_table`, `create_object_type` (confirmation required), `import_data` (confirmation required), `create_connector` (confirmation required).
- **DataIngestionSkill** provides system prompt with explicit inference rules: column names containing `_id`/`_name` matching existing Object Types → relationship candidate; numeric columns → filterable; date columns → filterable + sortable; LLM proposes externalId column, label column, Object Type name/label.
- **Confirmation plan** shown to user includes: Object Type name + label, all properties with types and flags, relationship candidates, externalId column, label column. User confirms or rejects/modifies in one step; create + import execute sequentially.
- **Batch import** processes 1000 rows per batch, reports progress via SSE `tool_result` events. Prevents memory exhaustion on large files.
- **Database connections** stored encrypted in Connector table config JSON. Agent guides user through host → port → user → password → database, testing connectivity at each step.
- **Manual refresh** reuses existing Connector/Mapping to re-pull and upsert by externalId. No scheduled sync in this phase.
- **externalId and label** are LLM-inferred with user confirmation. Row number is the fallback externalId when no suitable unique column exists (disables upsert — refresh becomes full replace).
