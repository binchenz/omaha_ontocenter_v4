---
status: accepted
---

# Agent Connector — Ephemeral Import for AI-Native Data Onboarding

## Context

Chunmi (纯米) needs to import AVC market reports (Excel files, 51 historical reports spanning 22.12→26.04, monthly ongoing). The file format is semi-stable: column names may vary slightly ("零售额(万元)" vs "零售额"), but the semantic structure (market metrics by brand/model/month) remains consistent. The import is **user-initiated, interactive, and infrequent** (monthly or ad-hoc), not a scheduled pipeline.

Three existing architectural pieces frame this:

1. **ADR-0040/0045: Dataset + Pipeline architecture** — `Connector (raw) → Pipeline (clean) → SyncJob (object_instances)`. Designed for **production data pipelines**: durable configuration, scheduled pulls, persistent transforms with lineage.
2. **AI-native SaaS principle** — Agent is the primary interface; users express intent in natural language, Agent infers structure and proposes actions, users confirm via structured UI (not forms).
3. **PendingAction state machine** (designed earlier in this session) — all Agent-proposed write operations flow through `PendingAction(proposed) → user confirms → PendingAction(approved) → execution`, with structured confirmation cards showing preview data.

**The tension:** Connector/Pipeline are **persistent, scheduled, OPC-authored** abstractions. AVC import is **ephemeral, interactive, end-user-initiated**. Forcing AVC into the Connector/Pipeline model produces three mismatches:

- **Connector** expects a reusable data source (MySQL endpoint, API URL). A one-off uploaded file is not a "source."
- **Pipeline** persists transform steps for repeated execution. Column name variations ("零售额(万元)" → standardize) are **one-time semantic alignment**, not repeating transforms.
- **Mapping** binds a clean Dataset to an ObjectType indefinitely. User-uploaded data should map once, not persist as infrastructure.

Using the persistent primitives for ephemeral work creates configuration debt: stale Connectors, orphaned Pipelines, and a registry polluted with one-off upload artifacts.

## Decision

Introduce **AgentConnector** — a new abstraction for Agent-driven, ephemeral, session-scoped data import. AgentConnector reuses Dataset/SyncJob **execution infrastructure** but bypasses Connector/Pipeline **persistent configuration**.

### Core Principles

1. **Ephemeral configuration, durable execution** — transform logic lives in `PendingAction.payload` (transient), execution reuses Dataset/SyncJob (audited, reliable).
2. **Agent infers, user confirms** — Agent sees file headers/samples, infers semantic mapping + inline transforms, proposes as a `PendingAction`, user sees preview and confirms.
3. **One abstraction layer below Connector** — AgentConnector is not a subclass of Connector; it is a parallel entry point that writes directly to `dataset_rows` without touching the `connectors` table.

### Data Model

No new tables. AgentConnector state lives entirely in `PendingAction.payload`:

```typescript
// PendingAction where type = 'agent_import'
{
  fileId: string;               // uploaded file reference
  objectType: string;           // target ObjectType (Agent-inferred)
  
  transforms: InlineTransform[];  // one-shot column transforms
  // e.g. [{ column: "零售额(万元)", op: "multiply", arg: 10000, outputColumn: "零售额" }]
  
  mapping: Record<string, string>;  // clean column → property name
  // e.g. { "零售额": "retailValue", "品牌": "brand" }
  
  previewRows: any[];           // first 10 transformed rows (for confirmation card)
}
```

### Execution Flow

```
User uploads file → fileId
  ↓
Agent calls: preview_import_file(fileId)
  → Reads headers + sample rows
  → LLM infers: objectType, transforms (unit conversions, normalizations), column→property mapping
  → Creates PendingAction(type='agent_import', status='proposed', payload={...})
  → Returns actionId + preview
  ↓
Agent outputs: action_proposal event { actionId, summary: "导入 1240 行到 market_metric，映射关系如下..." }
  ↓
Frontend renders: structured confirmation card (table of mapping, preview of 10 transformed rows)
  ↓
User clicks Confirm → POST /actions/{actionId}/confirm
  ↓
Backend executes:
  1. Create raw Dataset (fileId → dataset_rows as JSONB)
  2. Apply inline transforms (in-memory, not persisted as Pipeline)
  3. Write clean Dataset (versioned, immutable)
  4. Enqueue SyncJob(datasetId, ephemeral mappingId)
  5. SyncJob → ImportEngine → object_instances
  ↓
PendingAction → completed
```

### Tool Interface

Two new tools in a new `DataImportSkill` (activated on `research` and `maintain` surfaces):

**`preview_import_file`**
- Input: `{ fileId: string, objectType?: string }` (objectType optional; Agent infers if omitted)
- Output: `{ actionId: string, inferredMapping: {...}, transforms: [...], sampleRows: [...], totalRows: number }`
- Side effect: creates `PendingAction(proposed)`

**`execute_import`**
- Input: `{ actionId: string }`
- Output: `{ syncJobId: string, message: "导入已排队" }`
- Prereq: `PendingAction.status === 'approved'` (enforced by HTTP endpoint, not tool)

### Relationship to Existing Architecture

| Concept | Persistent (Connector/Pipeline) | Ephemeral (AgentConnector) |
|---------|--------------------------------|---------------------------|
| Configuration storage | `connectors`, `pipelines`, `object_mappings` tables | `PendingAction.payload` (transient) |
| Transform definition | PipelineStep rows (reusable, versioned) | InlineTransform[] in payload (one-shot) |
| Trigger | Scheduled (cron, webhook) or manual via UI | User confirms PendingAction |
| Execution | Same (Dataset → SyncJob → ImportEngine) | Same |
| Lineage | Full (Connector → Pipeline → clean Dataset with step-level trace) | Simplified (fileId → clean Dataset, transforms recorded in PendingAction audit) |
| Use case | Production data pipelines (OPC-authored, repeating) | Ad-hoc user uploads (Agent-inferred, one-off) |

**No duplication:** both paths bottom out in the same `SyncJobWorker → ImportEngine` code (ADR-0040's "one write path"). AgentConnector is an *entry point*, not a parallel execution engine.

### Column Mapper as Agent Prompt Context

The "ColumnMapper plugin" idea from the earlier design becomes **Agent prompt context**, not runtime code:

```typescript
// system prompt fragment in DataImportSkill
`
When inferring column mappings, recognize these common market data conventions:
- "零售额(万元)" / "零售额" → retailValue (convert 万元 to 元: multiply by 10000)
- "零售量(万台)" → retailVolume (convert to 台: multiply by 10000)
- "品牌" → brand
- "型号" / "机型" → model
...
`
```

New data formats (Euromonitor, Nielsen) extend the prompt, not a mapper registry. If a format becomes frequent enough to warrant reuse, **that's** when it graduates to a persistent Connector + Pipeline.

## Considered Options

**A. Reuse Connector/Pipeline directly**
- Rejected: persistent configuration for ephemeral work creates debt (stale registry entries, unclear which configs are "real infrastructure" vs one-off uploads).

**B. ColumnMapper plugin registry + static format detection**
- Rejected: requires pre-enumerating all formats; Agent's strength is adapting to unseen variations. Plugin registry is over-engineering for the AI-native model.

**C. Agent infers, but writes persistent Pipeline**
- Rejected: pollutes Pipeline registry with one-off transforms; lineage overkill for user uploads.

**D. Inline everything in tool code, no PendingAction**
- Rejected: violates AI-native principle (all Agent writes go through confirmation); no preview; no audit trail.

## Consequences

### Positive

- **Zero configuration debt** — no stale Connectors or Pipelines from one-off uploads.
- **Format-agnostic by default** — Agent handles column name variations without code changes.
- **Consistent confirmation flow** — all Agent writes (ontology, data, actions) use PendingAction.
- **Reuses battle-tested execution** — Dataset/SyncJob/ImportEngine are unchanged.
- **Clear upgrade path** — if a data source becomes recurring, convert AgentConnector payload → persistent Connector + Pipeline (tooling can auto-generate from the PendingAction payload).

### Negative / Trade-offs

- **No reusable transform library** — each upload re-infers. If the same file format is uploaded 10 times, Agent makes the same inference 10 times. Mitigation: once a pattern is confirmed frequent, codify it (promote to Connector, or add to Agent prompt context).
- **Simplified lineage** — transform steps are recorded as opaque JSON in PendingAction, not as inspectable PipelineStep rows. Acceptable for one-off uploads; not acceptable for production data pipelines (those continue using Pipeline).
- **LLM dependency for correctness** — if Agent mis-infers a unit conversion, user must catch it at confirmation. Mitigation: preview rows are mandatory; confirmation card renders the *transformed* data, not just the mapping description.

### Open Questions (deferred, not blocking)

- **Batch upload** — if user uploads 50 AVC files at once, does Agent create 50 PendingActions, or one with 50 fileIds? Start with one-at-a-time; add batch if usage shows the need.
- **Re-import with corrections** — if user confirms import, then realizes a column was mis-mapped, how do they fix it? MVP: delete + re-upload. Future: `amend_import(actionId, correctedMapping)` tool.
- **File format support** — MVP: Excel + CSV. Future: PDF extraction, OCR, image tables via multimodal LLM.

### Implementation Notes

- **DataImportSkill lives in `agent/skills/`**, not `data-ingestion/`. The latter is the persistent Connector/Pipeline implementation.
- **PendingAction.type = 'agent_import'** is the discriminator. Execution dispatcher routes to `AgentImportExecutor`.
- **InlineTransform DSL** — start minimal: `{ op: 'multiply' | 'divide' | 'map' | 'compute', column, arg?, outputColumn }`. Extend as patterns emerge. Reuses query engine's expression compiler where possible (e.g. `compute` is a DSL expression string).
- **File storage** — uploaded files live in `UPLOAD_DIR` (already exists for Connector file uploads); cleaned up after SyncJob completes or PendingAction expires (7 days).

### Validation Against AI-Native Principles

✅ **Agent is primary interface** — file upload happens in chat context, not a separate admin page.
✅ **User confirms, not configures** — no form fields for column mapping; Agent proposes, user reviews preview.
✅ **Structured confirmation** — PendingAction + confirmation card with transformed data preview.
✅ **Extensible without code changes** — new formats handled via prompt context updates, not mapper plugins.

### Relationship to Open-Source Vision

For an open-source project, AgentConnector is **the right primitive to expose**:
- Community users bring diverse data sources (not just AVC).
- Agent-inferred mapping scales better than maintaining a format plugin library.
- Clear separation: persistent Connector/Pipeline for "productionized data ops" vs ephemeral AgentConnector for "interactive data onboarding."

The codebase remains a **toolbox for OPCs**, not a vertical SaaS app with hardcoded industry formats.
