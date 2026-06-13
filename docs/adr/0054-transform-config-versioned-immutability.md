# ADR-0054: TransformConfig Versioned Immutability

**Status:** Accepted  
**Date:** 2026-06-13  
**Deciders:** binchenz

## Context

PipelineStep compute functions (e.g., `normalize_brand`, `price_band`) need configuration parameters:
- Brand normalization: mapping dictionary ("MIDEA" → "美的", "CHUNMI" → "纯米", 50+ entries)
- Price banding: threshold definitions ([0-500, 500-1500, 1500-3000, 3000+])

These configs are **reusable across Pipelines** (5 product categories × 3 Pipelines each = 15 Pipelines sharing same brand dictionary), but also **need historical integrity** for immutable lineage (ADR-0045: re-running a PipelineRun 6 months later must use the same rules).

Four approaches were considered (see comparison table in grill session):
- **A (inline)**: Embed full config in each PipelineStep → self-contained but redundant
- **B (reference)**: PipelineStep references mutable global config → efficient but breaks lineage
- **C (snapshot)**: PipelineStep snapshots config content at creation → lineage + audit but storage redundant
- **D (version binding)**: PipelineStep references config name + version, configs are append-only → all benefits

## Decision

**TransformConfig is append-only versioned, PipelineStep binds to specific version numbers.**

### Schema

```prisma
model TransformConfig {
  id        String   @id @default(uuid())
  tenantId  String   // Tenant-owned (see Q12 rationale)
  name      String   // e.g., "appliance_brands", "default_price_bands"
  type      String   // enum: "brand_mapping" | "price_bands" (validated)
  config    Json     // type-specific structure (validated via zod)
  version   Int      // auto-increment per (tenantId, name)
  createdAt DateTime @default(now())
  createdBy String?  // user who created this version

  @@unique([tenantId, name, version])
  @@index([tenantId, name])  // list latest version
}

model PipelineStep {
  // ... existing fields
  config Json  // includes:
  // {
  //   function: "normalize_brand",
  //   configRef: "appliance_brands",
  //   configVersion: 3  // locked to v3
  // }
}
```

### Type-specific config schemas

Validated at TransformConfig creation via zod:

```typescript
const TRANSFORM_CONFIG_SCHEMAS = {
  brand_mapping: z.object({
    mappings: z.record(z.string(), z.string()),  // {alias: canonicalName}
    caseSensitive: z.boolean().optional().default(false)
  }),
  price_bands: z.object({
    bands: z.array(z.object({
      max: z.number().optional(),  // omit for open-ended upper
      label: z.string()
    }))
  })
};
```

### Lifecycle

**Create new config or version**:
```typescript
// First version
POST /transform-configs
{
  name: "appliance_brands",
  type: "brand_mapping",
  config: {
    mappings: {"MIDEA": "美的", "CHUNMI": "纯米"},
    caseSensitive: false
  }
}
→ Creates version 1

// Update (append new version)
POST /transform-configs
{
  name: "appliance_brands",  // same name
  type: "brand_mapping",
  config: {
    mappings: {"MIDEA": "美的", "CHUNMI": "纯米", "chunmi": "纯米"},  // added entry
    caseSensitive: false
  }
}
→ Creates version 2 (version 1 unchanged)
```

**Pipeline creation resolves latest version**:
```typescript
// Agent calls configure_pipeline with:
{
  steps: [{
    type: "compute",
    config: {
      function: "normalize_brand",
      configRef: "appliance_brands"  // no version specified
    }
  }]
}

// Backend resolves:
const latest = await prisma.transformConfig.findFirst({
  where: {tenantId, name: "appliance_brands"},
  orderBy: {version: 'desc'}
});
// Saves to PipelineStep.config:
{
  function: "normalize_brand",
  configRef: "appliance_brands",
  configVersion: latest.version  // e.g., 3
}
```

**PipelineRunWorker execution**:
```typescript
const stepConfig = step.config;
const transformConfig = await prisma.transformConfig.findFirstOrThrow({
  where: {
    tenantId,
    name: stepConfig.configRef,
    version: stepConfig.configVersion  // locked version
  }
});
// Use transformConfig.config for execution
```

### Tenant ownership

TransformConfig is tenant-scoped (not global shared). Rationale:
- Tenant isolation:纯米's "纯米" mapping doesn't affect other tenants
- Permission model simplicity: no need for "global admin" role
- Future: "config marketplace" (like ADR-0034 Template Library) allows copying from shared templates into tenant namespace

## Consequences

### Positive

- **Config reuse**: 15 Pipelines reference one `appliance_brands`, maintain in one place
- **Immutable lineage**: PipelineRun re-executed 6 months later uses exact same rules (locked version)
- **Audit trail**: `transform_configs` table is append-only history, can trace "what was v3's mapping for '纯米'?"
- **Storage efficiency**: Dictionary stored once per version, not once per Pipeline (vs snapshot approach)
- **Upgrade visibility**: Frontend can show "Pipeline uses v3, current is v5" → one-click upgrade
- **Agent-friendly**: LLM can `list_transform_configs()` to discover reusable configs, or inline new params directly

### Negative

- **JOIN on execution**: PipelineRunWorker queries `transform_configs` per compute step (mitigated by caching)
- **Append-only growth**: Table grows with every config update; needs periodic archival of ancient versions
- **Version management UX**: Frontend needs "view diff between v3 and v5" tooling for FDE to understand changes

## Alternatives Considered

See grill session Q8 detailed comparison. Key rejected alternatives:

### A (inline params)
```typescript
{config: {function: "normalize_brand", params: {mappings: {...50 entries...}}}}
```
**Rejected**: Redundant storage (5 Pipelines = 5 copies of 50-entry dict), updates require touching all Pipelines.

### B (mutable reference)
```typescript
{config: {function: "normalize_brand", configRef: "appliance_brands"}}
// Always resolves to latest version at execution time
```
**Rejected**: Breaks immutable lineage — re-running old PipelineRun uses new rules, results not reproducible.

### C (snapshot)
```typescript
// At Pipeline creation, copy full config into PipelineStep.config
{config: {function: "normalize_brand", params: {...}, _snapshotFrom: {name, version, date}}}
```
**Rejected**: Redundant storage (same as A), though audit trail is better. Version binding achieves same benefits via JOIN instead of duplication.

## Migration Path

This ADR is foundational for ADR-0055 (AVC convergence). Implementation order:

1. Create `transform_configs` table + zod validation
2. Implement `create_transform_config` + `list_transform_configs` Agent tools
3. Update `configure_pipeline` tool to resolve `configRef` → `configVersion`
4. Update PipelineRunWorker to JOIN `transform_configs` when executing compute steps
5. Seed initial configs: `appliance_brands` (brand mapping), `default_price_bands` (AVC price bands)

## Notes

- Version numbers are per `(tenantId, name)` scope, not global
- No `delete` or `update` operations on TransformConfig — only `create` (append)
- Archival strategy (for 2-year-old versions) deferred to operational runbook
- Initial configs (appliance_brands, default_price_bands) seeded via migration script during AVC convergence (ADR-0055 Step 2)
