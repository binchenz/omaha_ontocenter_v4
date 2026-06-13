# ADR-0055: AVC Convergence into Connector Pipeline

**Status:** Accepted  
**Date:** 2026-06-13  
**Deciders:** binchenz

## Context

AVC (market intelligence) data ingestion is currently implemented via `MarketMetricImporter`, a specialized service that parses AVC Excel reports and directly writes to `object_instances`. This was expedient scaffolding, but conflicts with the long-term architecture vision:

**Current state** (specialized):
```
Excel → AvcTemplateExtractor.extract()
  → {marketMetric, brandShare, modelMetric} rows
  → MarketMetricImporter.importStar()
    → kind='clean' Dataset (already processed)
    → SyncJob → object_instances
```

**Target state** (generic):
```
Excel → Connector.fetch()
  → kind='raw' Dataset (unprocessed source)
  → Pipeline (configurable transforms)
    → kind='clean' Dataset
    → SyncJob → object_instances
```

The grilling session (Q5 "AVC 场景在长期架构设计来看，还需要保留吗？") resolved: **AVC is scaffolding to be removed, not a permanent vertical module.** The goal is AI-native: Agent configures and controls Pipelines (Q3b decision: full lifecycle control), AVC must converge into that model.

## Decision

**AVC ingestion converges into the generic Connector + Pipeline path. Fan-out happens at Connector layer (three raw Datasets).**

### Architecture

**One AVC Connector, three Pipelines**:

```
┌─────────────────────────┐
│ AvcConnector (type='avc_excel')
│ fetch() parses Excel     
└──┬──────────┬──────────┬─┘
   │          │          │
   v          v          v
raw Dataset  raw Dataset  raw Dataset
(market)     (brand)     (model)
kind='raw'   kind='raw'  kind='raw'
   │          │          │
   v          v          v
Pipeline 1   Pipeline 2  Pipeline 3
steps:       steps:      steps:
- filter     - normalize - price_band
             - brand
   │          │          │
   v          v          v
clean Dataset clean Dataset clean Dataset
   │          │          │
   v          v          v
SyncJob      SyncJob     SyncJob
   │          │          │
   v          v          v
market_metric brand_share model_metric
(ObjectType)  (ObjectType) (ObjectType)
```

**Why fan-out at Connector layer (three raw Datasets) instead of Pipeline layer (one raw → three clean)?**

1. **One Excel file = three semantically distinct datasets**: Market aggregates, brand shares, and model details are separate business dimensions, not filter branches of a single table
2. **Independent lineage**: Each star (market/brand/model) has its own refresh cadence, failure modes, retry needs — represented as three independent Dataset → Pipeline → SyncJob chains
3. **Keeps Pipeline 1→1**: `Pipeline.outputObjectTypeId` remains singular, `@@unique([tenantId, connectorId, outputObjectTypeId])` constraint holds, no need for multi-output Pipeline semantics
4. **Connector's job is format translation**: AvcConnector understands Excel structure (which sheets map to which stars); Pipeline's job is data cleaning (brand normalization, price banding)

### Component changes

**AvcConnector** (new):
- Wraps `AvcTemplateExtractor.extract()`
- Creates **three** raw Datasets per Excel file:
  ```typescript
  async fetch(filePath: string) {
    const extracted = AvcTemplateExtractor.extract(filePath);
    const baseConnector = await this.findOrCreateConnector({type: 'avc_excel'});
    
    // Create three raw Datasets
    const marketDs = await datasetService.createDataset({
      name: `avc_market_${extracted.category}_${extracted.period}`,
      connectorId: baseConnector.id,
      kind: 'raw'
    });
    await datasetService.appendRows(marketDs.id, extracted.marketMetric);
    await datasetService.markReady(marketDs.id);  // triggers Pipeline 1
    
    // Repeat for brandShare → Pipeline 2, modelMetric → Pipeline 3
  }
  ```

**Pipeline definitions** (created by migration script):
```typescript
// Pipeline 1: market_metric
{
  connectorId: avcConnectorId,
  outputObjectTypeId: marketMetricTypeId,
  steps: [
    {order: 1, type: "filter", config: {
      field: "value", operator: "gte", value: 0  // filter invalid rows
    }}
  ]
}

// Pipeline 2: brand_share
{
  connectorId: avcConnectorId,
  outputObjectTypeId: brandShareTypeId,
  steps: [
    {order: 1, type: "compute", config: {
      function: "normalize_brand",
      inputField: "brand",
      outputField: "brand",
      configRef: "appliance_brands"  // ADR-0054 versioned config
    }}
  ]
}

// Pipeline 3: model_metric
{
  connectorId: avcConnectorId,
  outputObjectTypeId: modelMetricTypeId,
  steps: [
    {order: 1, type: "compute", config: {
      function: "price_band",
      inputField: "price",
      outputField: "priceBand",
      configRef: "default_price_bands"
    }}
  ]
}
```

**MarketMetricImporter** (downgraded):
- `importReport()` reduced to only call `importReportCoverage()` (provenance metadata)
- `importStar()` deleted
- Coverage data does NOT go through Dataset/Pipeline (per ADR-0043 §2: provenance is metadata, not Dataset data)

### Transform capabilities (new)

Brand normalization is currently **not implemented** — AVC stores raw brand strings. Convergence into Pipeline adds this capability:

**Before** (no normalization):
```
Excel column: "美的", "MIDEA", "Midea"
→ stored as-is in brand_share.brand
→ user queries fragment across aliases
```

**After** (normalized via Pipeline):
```
Excel column: "美的", "MIDEA", "Midea"
→ raw Dataset preserves originals
→ Pipeline Step (normalize_brand, configRef: "appliance_brands")
→ clean Dataset: all become "美的"
→ brand_share.brand is canonical
```

## Migration Path

**5-step rollout** (test each step before next):

### Step 1 — Define AvcConnector (no-op)
- Create `AvcConnector` class, type='avc_excel'
- `fetch()` wraps `AvcTemplateExtractor` but returns structured data to `MarketMetricImporter` (current flow unchanged)
- **Validation**: Existing AVC ingestion still works

### Step 2 — Seed TransformConfigs + Pipelines (migration script)
- Insert `appliance_brands` TransformConfig (brand mappings: "MIDEA"→"美的", "CHUNMI"→"纯米", etc.)
- Insert `default_price_bands` TransformConfig (AVC standard bands: 0-500, 500-1500, ...)
- Create three Pipelines (per definitions above), status='draft'
- **Validation**: `SELECT * FROM pipelines WHERE connectorId = avc_connector_id` returns 3 rows

### Step 3 — AvcConnector produces raw Datasets (breaking change)
- `fetch()` creates three raw Datasets + markReady() (triggers Pipelines via ADR-0045 reactive chain)
- `MarketMetricImporter.importReport()` stops calling `importStar()`, only calls `importReportCoverage()`
- **Validation**: 
  - Upload test AVC Excel
  - Verify 3 PipelineRuns enqueued
  - Verify 3 clean Datasets created
  - Verify 3 SyncJobs complete
  - Query `brand_share` → brands are normalized

### Step 4 — Activate Pipelines
- Update Pipelines: status='draft' → 'active'
- **Validation**: Future AVC uploads automatically trigger Pipelines

### Step 5 — Delete legacy code
- Delete `MarketMetricImporter.importStar()` method
- Mark `MarketMetricImporter.importReport()` deprecated (if external scripts call it)
- **Validation**: Grep codebase for `importStar` → zero results

## Consequences

### Positive

- **AI-native**: Agent can now `configure_pipeline`, `trigger_pipeline_run`, inspect status — full lifecycle control (Q3b decision)
- **Unified path**: AVC data flows through same Connector → Dataset → Pipeline → SyncJob path as future external data sources (DB connectors, CSV uploads)
- **Reusable transforms**: Brand normalization and price banding become reusable TransformConfig assets, not AVC-specific code
- **Lineage integrity**: Every transform decision (which brand mapping version, which price bands) is recorded in PipelineRun → Dataset lineage
- **New capability**: Brand normalization (didn't exist before) now applied to AVC data

### Negative

- **Migration risk**: AVC is production data for纯米; 5-step rollout needed to avoid breaking live ingestion
- **Complexity increase (short-term)**: During Steps 1-3, both old path (MarketMetricImporter) and new path (Connector+Pipeline) exist; confusion risk
- **Transform expressiveness limit**: ADR-0053 enum-constrained steps may not cover future AVC needs (e.g., fuzzy matching beyond simple dictionary lookup); would require adding new predefined functions

## Alternatives Considered

### Alternative A: Keep AVC as permanent vertical module
Structure: `MarketMetricImporter` remains, Connector/Pipeline used only for generic external data.

**Rejected because**:
- User explicitly stated (Q5a): "要消失的脚手架" (scaffolding to be removed)
- Divergent paths increase maintenance burden (two ingestion code paths, two testing surfaces)
- Agent cannot control AVC ingestion (defeats AI-native vision)

### Alternative B: Multi-output Pipeline (one raw → three clean)
Structure: Single raw Dataset (mixed rows with `starType` column), one Pipeline with conditional branching.

**Rejected because**:
- Breaks Pipeline 1→1 model, requires schema change: `outputObjectTypeId String?` (nullable) or `outputObjectTypeIds String[]`
- Complicates Orchestrator: `onPipelineRunComplete()` can't lookup Mapping via `(connectorId, outputObjectTypeId)` triple
- Worse lineage granularity: can't re-run brand_share processing without re-running market_metric
- See Q5b detailed comparison for full analysis

### Alternative C: AVC stays specialized but uses Dataset/SyncJob
Structure: `MarketMetricImporter` creates clean Datasets (no Pipeline), directly triggers SyncJob.

**Rejected because**:
- Agent can't configure brand normalization or price banding (those stay in MarketMetricImporter code)
- Doesn't converge toward AI-native goal; just adds Dataset layer without gaining Pipeline benefits

## Notes

- Coverage data (`avc_report` ObjectType) remains outside Dataset/Pipeline path (per ADR-0043 §2)
- Brand normalization mappings need initial seeding (see Step 2); source: existing AVC Excel files (extract unique brand values, build canonical mapping)
- Price bands: AVC uses standard ranges (verified across 51 reports, 2022.12-2026.04); seed with observed bands
- PipelineRunWorker limit: 100K rows (ADR Q11); single AVC report ~1K rows, well within limit
- Future: If AVC adds new transform needs beyond filter/rename/compute, extend ADR-0053 predefined functions (e.g., `function: "fuzzy_match_brand"`)
