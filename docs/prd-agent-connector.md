# PRD: AgentConnector — AI-Native Data Import for Market Intelligence

## Problem Statement

Chunmi (纯米) uses this platform to analyze AVC market reports. Currently, when a new monthly AVC report arrives (Excel file), Chunmi cannot import it themselves — they must send the file to the development team, who manually runs a `bulk-ingest-avc.ts` script. This creates a bottleneck: Chunmi cannot access fresh data until a developer is available.

The underlying problem is more general: any SMB customer receiving periodic data files (market reports, supplier catalogs, sales exports) faces the same dependency. The platform has two existing data ingestion paths:
1. **Persistent Connector + Pipeline** — for scheduled, repeating data pulls (MySQL, PostgreSQL, API). Requires OPC configuration.
2. **Direct ImportEngine** — for one-time uploads, but with no semantic inference or user confirmation.

Neither fits the "user uploads an ad-hoc file in conversation, Agent infers structure, user confirms preview, data lands in the Ontology" interaction model that an AI-native product should provide.

## Solution

Build **AgentConnector** — an ephemeral, Agent-driven import path that:
1. Accepts file uploads in conversation context
2. Lets the Agent infer semantic mappings from file structure (via Skill prompt guidance)
3. Shows the user a structured confirmation card with transformed data preview
4. Executes the import asynchronously after confirmation

The solution reuses the platform's existing Dataset + SyncJob execution infrastructure (reliable, audited, transactional), but introduces a **PendingAction** state machine to handle user confirmation, and bypasses the persistent Connector/Pipeline configuration layer (which would create stale registry entries for one-off uploads).

After this is built, Chunmi uploads a new AVC file to the research Agent, confirms the inferred mapping in a preview card, and queries the fresh data immediately — no developer involved.

## User Stories

1. As a Chunmi operator, I want to upload this month's AVC Excel file directly to the Agent, so that I can query new market data without waiting for the development team.

2. As a Chunmi operator, I want the Agent to automatically recognize AVC column names like "零售额(万元)" and propose the correct unit conversion, so that I don't need to manually configure column mappings.

3. As a Chunmi operator, I want to see a preview of the transformed data (first 10 rows with units converted) before confirming import, so that I can catch mistakes in the Agent's inference.

4. As a Chunmi operator, I want to cancel an import proposal if the mapping looks wrong, and have the Agent adjust based on my feedback, so that I stay in control without losing conversation context.

5. As a Chunmi operator, I want the import to run asynchronously after I confirm, so that I can continue working in the Agent while the data loads.

6. As a Chunmi operator, I want to be notified when the import completes (or fails), so that I know when the data is ready to query.

7. As an OPC deploying this for a different customer, I want the Agent to handle CSV files with different column names (not just AVC), so that the same feature works for supplier catalogs, sales reports, etc.

8. As an OPC, I want to extend the Agent's semantic mapping knowledge by editing the DataImportSkill prompt (add "Supplier ID" → "supplierId" conventions), so that I can adapt to new data sources without writing code.

9. As a platform administrator, I want one-off uploads to NOT create persistent Connector or Pipeline records, so that the configuration registry stays clean and only contains real infrastructure.

10. As a platform administrator, I want every AgentConnector import to create an auditable PendingAction record with the full mapping and user confirmation, so that I can trace back what data was imported and who approved it.

11. As a platform administrator, I want AgentConnector imports to reuse the same SyncJob + ImportEngine path as persistent Connectors, so that data validation, error handling, and audit logging are consistent.

12. As a platform developer, I want inline transforms (unit conversions, column mappings) to be applied via a pure-function InlineTransformEngine, so that I can test transform logic independently of the Agent or database.

13. As a platform developer, I want the PendingAction state machine to be generic (not AVC-specific), so that future Agent write operations (bulk delete, schema migration, etc.) can reuse the same confirmation flow.

14. As a frontend developer, I want PendingAction confirmation to be rendered via a structured SSE event (not parsed from Agent text), so that I can show a proper UI card with table preview and Confirm/Cancel buttons.

15. As a user, I want to see the import progress after I confirm (queued → executing → completed), so that I know the system is working and not stuck.

16. As a user, I want detailed error messages if the import fails (e.g., "Row 47 has invalid date format"), so that I can fix the source file and retry.

17. As a user, I want to re-upload a corrected file after a failed import, and have the Agent remember the previous mapping attempt, so that I don't start from scratch.

18. As a user, I want the Agent to detect when I upload the same file twice and warn me before creating duplicate data, so that I don't accidentally import the same report multiple times.

19. As a user uploading a multi-sheet Excel file, I want the Agent to ask which sheet contains the data (or auto-detect if there's only one data sheet), so that I don't need to manually extract a CSV first.

20. As a user uploading a large file (10k+ rows), I want the preview to show only 10 rows but confirm the total count, so that I can verify the mapping without waiting for the full dataset to render.

21. As an OPC, I want to convert a frequently-used AgentConnector mapping into a persistent Pipeline, so that monthly uploads of the same format can be automated without re-inferring the mapping each time.

22. As a platform architect, I want AgentConnector to NOT call the LLM inside tool execution, so that tool code stays deterministic and testable.

23. As a platform architect, I want semantic inference to happen in the Agent layer (via Skill system prompt), so that the inference logic is visible in the conversation and can be debugged by reading Agent traces.

24. As a security reviewer, I want PendingAction approval to be tied to the user's session and expire after 1 hour, so that a stale confirmation link cannot be abused.

25. As a security reviewer, I want write authorization (`data.ingest` capability) to be checked at the SDK layer (not just the tool layer), so that the gate applies to both HTTP and Agent entry points.

## Implementation Decisions

### Architecture

**Three-layer separation (adhering to ADR-0008 + ADR-0040):**

1. **Agent layer** — infers mapping from file structure using Skill prompt guidance. Does NOT call LLM inside tools.
2. **Tool layer** — stateless executors that validate parameters and call SDK. Tools: `read_file_preview`, `preview_import_file`, `execute_import`.
3. **SDK/Service layer** — single write path with capability checks. All imports (persistent Connector or ephemeral AgentConnector) converge here.

**PendingAction as generic confirmation primitive:**

- New table: `pending_actions` (id, tenantId, conversationId, type, status, payload JSON, summary, createdBy, approvedBy, createdAt, approvedAt, expiresAt)
- Status flow: `proposed` → `approved` → `executing` → `completed` / `failed` / `cancelled`
- Type discriminator: `agent_import` (future: `bulk_delete`, `schema_migration`, etc.)
- Executor registry: `PendingActionExecutor` interface, implementations keyed by type

**Ephemeral config, durable execution:**

- AgentConnector does NOT write to `connectors` or `pipelines` tables
- Transform logic lives in `PendingAction.payload.transforms` (transient)
- Execution reuses `Dataset (kind='clean')` + `SyncJob` infrastructure
- Audit trail: PendingAction record + SyncJob record + ConversationTurn (full lineage)

**InlineTransformEngine as deep module:**

- Pure function: `apply(rows: Record<string, any>[], transforms: InlineTransform[]): Record<string, any>[]`
- Transform types: `multiply`, `divide`, `map` (dict lookup), `compute` (DSL expression)
- Zero dependencies on Agent, LLM, or database
- Reused by both `preview_import_file` (preview generation) and `AgentImportExecutor` (actual import)

### Schema Changes

**New table: `pending_actions`**

```prisma
model PendingAction {
  id             String   @id @default(uuid())
  tenantId       String
  conversationId String?
  type           String   // 'agent_import', 'bulk_delete', ...
  status         String   // 'proposed', 'approved', 'executing', 'completed', 'failed', 'cancelled'
  payload        Json     // type-specific parameters
  summary        String   // human-readable description for confirmation card
  createdBy      String   // user.id
  approvedBy     String?
  createdAt      DateTime @default(now())
  approvedAt     DateTime?
  expiresAt      DateTime // 1 hour from creation for 'proposed'
  executionError String?  // populated on 'failed'

  tenant       Tenant       @relation(fields: [tenantId], references: [id])
  conversation Conversation? @relation(fields: [conversationId], references: [id])

  @@index([tenantId, status])
  @@index([conversationId])
  @@map("pending_actions")
}
```

**payload structure for type='agent_import':**

```typescript
{
  fileId: string;
  objectType: string;
  transforms: Array<{
    column: string;
    op: 'multiply' | 'divide' | 'map' | 'compute';
    arg?: number | Record<string, string> | string; // depends on op
    outputColumn?: string; // if renaming
  }>;
  mapping: Record<string, string>; // clean column → property name
  previewRows: any[]; // first 10 transformed rows
  totalRows: number;
}
```

**No changes to existing tables** — Dataset, SyncJob, Conversation schemas are unchanged.

### Module Structure

**New: PendingActionModule** (`apps/core-api/src/modules/pending-action/`)

- `PendingActionService` — CRUD + state transitions, expiry cleanup
- `PendingActionController` — `POST /actions/:id/confirm`, `POST /actions/:id/cancel`, `GET /actions/:id/status`
- `PendingActionExecutor` (interface) — `execute(action: PendingAction): Promise<void>`
- `AgentImportExecutor` (implements PendingActionExecutor) — reads payload, applies transforms via InlineTransformEngine, creates Dataset, enqueues SyncJob
- `InlineTransformEngine` — pure transform logic

**New: DataImportSkill** (`apps/core-api/src/modules/agent/skills/data-import.skill.ts`)

- System prompt with AVC column conventions ("零售额(万元)" → multiply 10000, etc.)
- Tools: `read_file_preview`, `preview_import_file`, `execute_import`
- Activated on `research` and `maintain` surfaces

**New: Agent Tools** (`apps/core-api/src/modules/agent/tools/`)

- `ReadFilePreviewTool` — reads file, returns headers + first 10 rows (no transform)
- `PreviewImportFileTool` — receives Agent-inferred mapping, applies transforms, creates PendingAction(proposed), returns actionId + preview
- `ExecuteImportTool` — receives actionId, transitions PendingAction to approved, triggers executor

**Modified: AgentModule** — register DataImportSkill + 3 new tools

**Modified: Frontend** (`apps/web/components/chat/`)

- New SSE event type: `action_proposal` (payload: actionId, summary, previewRows, totalRows)
- New component: `PendingActionCard` — renders table preview, Confirm/Cancel buttons
- Confirm button → `POST /actions/:id/confirm` → re-enables input
- Cancel button → `POST /actions/:id/cancel` → sends rejection to Agent as tool result

### API Contracts

**Tool: `read_file_preview`**

```typescript
Input: { fileId: string }
Output: {
  fileId: string;
  filename: string;
  headers: string[];
  sampleRows: any[]; // first 10 rows
  totalRows: number;
  sheets?: string[]; // if Excel, list of sheet names
}
```

**Tool: `preview_import_file`**

```typescript
Input: {
  fileId: string;
  objectType: string; // Agent-inferred target ObjectType
  transforms: InlineTransform[];
  mapping: Record<string, string>; // clean column → property
}
Output: {
  actionId: string; // PendingAction.id
  previewRows: any[]; // first 10 transformed rows
  totalRows: number;
  summary: string; // e.g. "导入 1240 行到 market_metric，零售额已转换为元"
}
Side effect: creates PendingAction(type='agent_import', status='proposed')
```

**Tool: `execute_import`**

```typescript
Input: { actionId: string }
Output: {
  syncJobId: string;
  message: string; // e.g. "导入已排队，预计 30 秒完成"
}
Prereq: PendingAction.status === 'approved' (enforced by HTTP endpoint)
Side effect: transitions PendingAction → executing, enqueues SyncJob
```

**HTTP: `POST /actions/:id/confirm`**

```typescript
Input: (empty body, authenticated user from JWT)
Output: { status: 'approved', executorStarted: true }
Auth: user.id must match PendingAction.createdBy
Side effect: sets approvedBy, approvedAt, status='approved', triggers executor async
```

**HTTP: `POST /actions/:id/cancel`**

```typescript
Input: { reason?: string }
Output: { status: 'cancelled' }
Side effect: sets status='cancelled', does NOT trigger executor
```

**SSE event: `action_proposal`**

```typescript
{
  type: 'action_proposal',
  actionId: string,
  summary: string,
  preview: {
    objectType: string,
    transforms: string[], // human-readable: ["零售额(万元) → 元 (×10000)"]
    sampleRows: any[],
    totalRows: number,
  }
}
```

### Execution Flow

**Happy path:**

```
1. User uploads file via existing POST /files/upload → fileId
2. User: "帮我导入这个 AVC 文件"
3. Agent activates DataImportSkill (surface=research)
4. Agent calls read_file_preview(fileId)
   → Tool reads Excel, returns headers + 10 rows
5. Agent sees headers ["零售额(万元)", "品牌", "型号"]
   → Skill prompt guides: "零售额(万元)" needs multiply(10000)
   → Agent infers: objectType=market_metric, transforms=[{column:"零售额(万元)",op:"multiply",arg:10000,outputColumn:"零售额"}], mapping={"零售额":"retailValue","品牌":"brand","型号":"model"}
6. Agent calls preview_import_file(fileId, objectType, transforms, mapping)
   → Tool applies InlineTransformEngine.apply(rows, transforms)
   → Tool creates PendingAction(proposed), payload={...}, expiresAt=now+1h
   → Tool returns actionId + previewRows
7. Agent outputs action_proposal SSE event
8. Frontend renders PendingActionCard with table (10 rows, transformed values)
9. User clicks Confirm
   → Frontend: POST /actions/{actionId}/confirm
   → Backend: PendingAction → approved, triggers AgentImportExecutor async
10. AgentImportExecutor:
    → Reads full file
    → Applies transforms via InlineTransformEngine
    → Creates Dataset(kind='clean', name='agent_import_{actionId}')
    → Appends transformed rows
    → Marks ready
    → Enqueues SyncJob(datasetId, ephemeral mappingId)
11. SyncJobWorker (pg-boss consumer):
    → Reads Dataset rows
    → Calls ImportEngine.importInstances(tenantId, objectType, instances)
    → Updates PendingAction → completed
12. Agent sends completion message: "已导入 1240 行数据，现在可以查询了"
```

**Error paths:**

- File not found → read_file_preview returns error, Agent apologizes
- Invalid mapping (Agent infers wrong objectType) → user cancels in step 9, rejection fed back to Agent as tool result, Agent re-proposes
- Transform fails (divide by zero, invalid compute expression) → InlineTransformEngine throws, caught in preview step, Agent sees error, adjusts
- SyncJob validation fails (row 47 has invalid date) → SyncJob → failed, PendingAction → failed with executionError, Agent notifies user with specific row
- Import times out (30s tx limit) → SyncJob retries 3×, then fails, PendingAction → failed
- User never confirms → PendingAction expires after 1h, cleanup cron deletes it

### Testing Strategy

**What makes a good test:**

- Tests verify behavior through public interfaces (service methods, HTTP endpoints), not internal implementation
- Tests describe what the system does ("user can preview transformed data"), not how it does it ("InlineTransformEngine calls multiply()")
- A test should survive internal refactors — if you rename a private method, tests don't break

**Modules to test:**

1. **InlineTransformEngine (unit tests, mandatory)**
   - Input: rows + transforms, output: transformed rows
   - Test cases: multiply, divide, map (dict lookup), compute (DSL expression), chained transforms, error handling (invalid column, divide by zero)
   - Prior art: `compiler.spec.ts` (DSL expression tests)

2. **PendingActionService (unit tests, mandatory)**
   - State transitions: proposed → approved → executing → completed/failed
   - Expiry: actions expire after 1h if not approved
   - Authorization: only createdBy user can confirm
   - Prior art: `action-handler.service.spec.ts` (similar state machine)

3. **AgentImportExecutor (integration tests, optional but recommended)**
   - End-to-end: PendingAction payload → Dataset → SyncJob → object_instances
   - Mock pg-boss queue, verify SyncJob enqueued with correct params
   - Prior art: `market-metric-importer.spec.ts` (similar Dataset → SyncJob flow)

4. **Tools (no unit tests — covered by e2e)**
   - Tools are thin wrappers around services
   - Tool correctness verified by agent e2e scenarios

5. **Agent e2e (scenario tests, mandatory)**
   - Scenario: "User uploads AVC, Agent proposes mapping, user confirms, data lands"
   - Verify: tool_call sequence, action_proposal event structure, final query returns imported data
   - Prior art: `market-intelligence.e2e-spec.ts` (similar multi-step Agent scenarios)

6. **Frontend (manual verification for MVP, automated later)**
   - PendingActionCard renders preview table correctly
   - Confirm/Cancel buttons trigger correct API calls
   - SSE event handling doesn't break existing message flow

**Test execution:**

```bash
# Unit tests (fast, no DB)
cd apps/core-api && npx jest inline-transform-engine.spec.ts --no-coverage
cd apps/core-api && npx jest pending-action.service.spec.ts --no-coverage

# Integration tests (with test DB)
cd apps/core-api && npx jest agent-import-executor.spec.ts --no-coverage

# E2E (hits real LLM, not in CI)
cd apps/core-api && npx jest agent-connector.e2e-spec.ts --no-coverage --forceExit
```

## Out of Scope

**Deferred to future iterations:**

1. **Batch upload** — uploading 50 AVC files at once. MVP: one file at a time.
2. **Re-import with corrections** — if user confirms, then realizes mapping was wrong, how to fix without deleting and re-uploading. MVP: delete + re-upload.
3. **PDF extraction** — AVC files are Excel/CSV for now. PDF text extraction deferred.
4. **OCR / image tables** — not supported in MVP.
5. **Connector promotion** — converting a frequently-used AgentConnector mapping into a persistent Pipeline. MVP: manual process (OPC writes Pipeline config).
6. **Duplicate detection** — warning if same file uploaded twice. MVP: user responsibility.
7. **Multi-sheet Excel auto-detection** — if Excel has multiple sheets, Agent asks which one. MVP: assumes first sheet or errors.
8. **Large file streaming** — files >50MB or >100k rows. MVP: 50MB hard limit (enforced by existing FileController).
9. **Incremental import** — appending new rows to existing ObjectType without full refresh. MVP: full replace via ImportEngine's upsert-by-externalId logic.
10. **Column-level validation preview** — showing "Row 47: invalid date" in the preview card before confirming. MVP: validation errors surface only after SyncJob starts.
11. **Frontend SSE reconnection** — if connection drops mid-import, user must refresh. Existing limitation, not specific to AgentConnector.
12. **PendingAction bulk operations** — approving/cancelling multiple actions at once. MVP: one at a time.

**Explicitly NOT in scope:**

- **LLM inference inside tools** — semantic mapping happens in Agent layer (Skill prompt), NOT in tool code. This is an architectural invariant.
- **Persistent Connector/Pipeline for one-off uploads** — AgentConnector is designed to avoid this. Frequent imports that need reuse should be manually promoted by OPC.
- **Real-time progress updates** — SyncJob runs async, user sees "queued → completed" via polling or final notification. No live row-by-row progress.

## Further Notes

### Relationship to Existing AVC Import

The `extract_avc_report` tool (existing) and `preview_import_file` (new) serve different use cases:

- **extract_avc_report** — hardcoded for AVC template extraction (knows about sheet "2-1", "2-5", "2-7"), creates three star ObjectTypes (market_metric, brand_share, model_metric), bypasses user confirmation. Used for bulk ingestion of the historical 51-file archive.
- **preview_import_file** — generic, Agent-inferred mapping, user confirmation required, works for any tabular data (not just AVC). Used for ongoing monthly uploads.

Both can coexist. For Chunmi's monthly workflow, they will use `preview_import_file` (more flexible, confirmation step). The bulk script (`avc-bulk-ingest.ts`) can continue using `extract_avc_report` for backfills.

### Migration Path

1. **Phase 1 (this PRD)**: Build PendingAction + AgentConnector, test with AVC files
2. **Phase 2**: Chunmi uses new flow for 26.06, 26.07, 26.08 monthly uploads
3. **Phase 3**: If Chunmi confirms format is stable and they want automation, OPC promotes the mapping to a persistent Connector + Pipeline (manual config, not automated by this feature)
4. **Phase 4**: Other customers (non-AVC data) use AgentConnector for their ad-hoc uploads

### Performance Considerations

- **File size limit**: 50MB (existing FileController limit). AVC files are ~2-5MB, well within limit.
- **Row count**: InlineTransformEngine processes in-memory (no streaming). For 10k-row files (~typical AVC size), this is <1s. For 100k+ rows, may need chunked processing (deferred).
- **Preview render**: Only 10 rows sent to frontend, even if file has 10k rows. Full dataset never rendered in preview card.
- **SyncJob timeout**: 30s transaction limit (existing ImportEngine). AVC imports (~1-2k rows) finish in <5s. Larger imports may need batching (future work).

### Security Notes

- **Write authorization**: `data.ingest` capability checked at SDK layer (ResearchSdk or new DataImportSdk). Both HTTP and Agent paths go through same gate (ADR-0040 compliance).
- **PendingAction ownership**: only the user who created the action (createdBy) can confirm it. Frontend must pass JWT, backend validates user.id match.
- **Expiry**: actions expire 1h after creation if not approved. Cleanup cron runs hourly to delete expired actions.
- **Payload sanitization**: transforms and mapping are validated before execution (column names must match file headers, no SQL injection via computed expressions — DSL compiler already has this guard).

### Open Questions (to resolve during implementation)

1. **Where does InlineTransformEngine's `compute` operation compile DSL expressions?** Reuse existing query compiler, or build a minimal expression evaluator?
   - Recommendation: reuse `packages/dsl/src/compiler.ts` expression compilation, extract the standalone expression evaluator into a util.

2. **How does Agent learn the target ObjectType if it doesn't exist yet?** For Chunmi, market_metric already exists. For new customers, Agent would need to call `create_object_type` first, then `preview_import_file`.
   - Recommendation: DataImportSkill prompt includes guidance: "If objectType doesn't exist, call create_object_type first."

3. **Should PendingAction have a ttl/auto-delete after completion?** Or keep forever for audit?
   - Recommendation: keep completed actions for 90 days (audit retention), then hard-delete. Separate from 1h expiry for un-approved actions.

4. **Does `execute_import` tool need `requiresConfirmation=true`?** The action is already approved at this point.
   - Recommendation: no. The confirmation happened at preview step. execute_import is just a trigger.

5. **Should InlineTransformEngine support chained transforms?** E.g., first multiply, then map.
   - Recommendation: yes, process transforms in order. Add test case for it.

6. **What if user uploads a file with 100 columns but only wants to import 5?** Agent infers full mapping, user has no way to "deselect" columns in preview card.
   - Recommendation: Agent can omit columns from the mapping param (unmapped columns are dropped). Preview card shows only mapped columns. User can ask "don't import column X" and Agent re-calls preview with adjusted mapping.
