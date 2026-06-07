# Pipeline Architecture — Immutable Lineage, Two Queues, Reactive Orchestration

The data plane needs a transform layer between raw Connector data and clean Object Instances. We chose immutable lineage with a separate PipelineRun queue, a single orchestrator, and explicit Dataset `kind` discrimination — over mutating transforms, a single overloaded SyncJob queue, or event-driven coordination.

## Considered Options

**Transform execution model:**
- A) Immutable lineage — Pipeline produces a *new* clean Dataset from a raw one; raw is never mutated ✅
- B) Mutating transform — overwrite rows in place, bump version

Chose A: re-runnable (fix the Pipeline, re-run from preserved raw), auditable (trace any clean row to source), matches the glossary's "lineage recorded at step level." Version on Dataset means "Nth refresh of this logical Dataset."

**Job separation:**
- A) Single SyncJob queue for both transform and import (discriminated by payload type)
- B) Separate `pipeline-run` queue + existing `sync-job` queue ✅
- C) Pipeline runs synchronously inside SyncJob

Chose B: independent retry semantics (data validation failure ≠ transform bug), independent observability, workers stay single-responsibility. pg-boss supports multiple named queues at zero cost.

**Orchestration:**
- A) Single `DataPipelineOrchestrator` with two trigger methods ✅
- B) Each worker triggers the next inline
- C) Domain events + event handlers

Chose A: the full chain is 3 steps — event infra is overkill. One file shows the entire trigger chain. Workers stay focused on processing logic.

**Trigger model:**
- A) Reactive on `markReady` — orchestrator finds Pipeline by `connectorId` and auto-enqueues ✅
- B) Caller responsibility (imperative) — each adapter must know to trigger Pipeline

Chose A (for Pipeline path only): callers shouldn't know Pipeline topology. Direct-clean callers (MarketMetricImporter) still enqueue SyncJob themselves — the orchestrator only manages the Pipeline-triggered chain.

## Key Design Decisions

1. **Dataset.kind: 'raw' | 'clean'** — SyncJob hard-fails if `kind !== 'clean'`. Migration defaults existing rows to `'clean'`. Callers choose kind at creation (pre-cleaned data enters as `clean` directly).

2. **Pipeline.connectorId** — stable input binding. The OPC says "this Pipeline cleans data from this Connector." Multiple Pipelines per Connector allowed, one per target Object Type: `@@unique([tenantId, connectorId, outputObjectTypeId])`.

3. **Pipeline.outputObjectTypeId** — how the orchestrator finds the Mapping after PipelineRun completes. Lookup: `findMapping({ tenantId, objectTypeId: pipeline.outputObjectTypeId })`.

4. **ObjectMapping.datasetId removed** — SyncJob carries both `datasetId` and `mappingId` directly. The Mapping is a template ("how to map"), not a pointer to a specific Dataset snapshot.

5. **PipelineStep executes in-memory** — no materialized intermediates. Steps run sequentially; only the final result is persisted as a new clean Dataset. Debugging a specific step is a future opt-in diagnostic mode.

6. **Clean Dataset naming:** `${pipeline.name}_clean` with auto-incrementing version.

7. **All-or-nothing sync** — ImportEngine's existing transactional upsert semantics. Retry classified: transient errors (DB timeout) retry 3× with backoff; permanent errors (validation) fail immediately.

8. **Trigger-all-active-Pipelines** — when a raw Dataset is marked ready, all active Pipelines for that Connector fire. Each Pipeline's filter step selects its relevant subset.

9. **Provenance stays direct** — `avc_report` provenance writes via ImportEngine directly, never through Dataset/Pipeline (per ADR-0043 §2). Star data always goes through Dataset.

10. **DSL TableTarget parametrization dropped** — no concrete caller in this architecture. Pipeline steps are in-memory transforms, not SQL. Re-add when a real use case appears.

## Module Boundaries

```
PipelineModule (new)
  ├─ imports: DatasetModule (SyncJobService), MappingModule (MappingService)
  ├─ PipelineService           — CRUD for Pipeline + PipelineStep
  ├─ PipelineRunService        — enqueue, status tracking
  ├─ PipelineRunWorker         — pg-boss 'pipeline-run' consumer
  └─ DataPipelineOrchestrator  — onRawDatasetReady / onPipelineRunComplete

DatasetModule (unchanged)
  ├─ DatasetService            — CRUD + appendRows + markReady
  ├─ SyncJobService            — enqueue, getJob, listJobs
  └─ SyncJobWorker             — pg-boss 'sync-job' consumer → ImportEngine
```

Dependency direction: `PipelineModule → DatasetModule → AgentSdkModule → OntologyModule`. No cycles.

## Consequences

- The current Slice 0–5 implementation works for the immediate MVP (direct-clean path). Pipeline implementation is additive — it does not require rewriting the existing flow.
- `ObjectMapping.datasetId` removal and `SyncJob.mappingId` addition are part of the Pipeline implementation, not a standalone migration.
- The DSL `TableTarget` code (Slice 3) is dead code until reverted — flag for cleanup.
- Permission: `pipeline.author` gates the Pipeline Surface (already shipped in shared-types).
