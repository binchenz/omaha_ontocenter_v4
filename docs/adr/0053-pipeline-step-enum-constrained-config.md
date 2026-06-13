# ADR-0053: Pipeline Step Enum-Constrained Config

**Status:** Accepted  
**Date:** 2026-06-13  
**Deciders:** binchenz

## Context

PipelineStep allows data transformation (filter, rename, compute) on Dataset rows before syncing to object_instances. The `type` and `config` fields determine what transformation happens. We need to decide: structured enum vs free DSL.

Two forces:
1. **Agent-friendliness**: LLM generates step configs when configuring Pipelines (Q3b decision: Agent has full lifecycle control)
2. **Validation timing**: Invalid config discovered at PipelineRun execution time wastes cycles; pre-validation at creation time prevents bad Pipelines

ADR-0026 (Axis A) proved enum-constrained parameters are more reliable for LLM than free text (8/8 vs 5/8 success rate).

## Decision

**PipelineStep.type and config are enum-constrained with JSON Schema validation.**

### Supported types (MVP)

```typescript
type StepType = "filter" | "rename" | "compute";
```

### Config schemas

**filter** (single condition only, compose via multiple steps):
```typescript
{
  field: string,
  operator: "eq" | "gt" | "lt" | "gte" | "lte" | "contains" | "in",
  value: string | number | string[]
}
```

**rename** (column renaming only, no selection/projection):
```typescript
{
  mappings: Record<string, string>  // {oldName: newName}
}
```

**compute** (predefined functions, not general expressions):
```typescript
{
  function: "normalize_brand" | "price_band",  // extensible enum
  inputField: string,
  outputField: string,
  configRef?: string,        // reference to TransformConfig (see ADR-0054)
  configVersion?: number,    // locked version
  params?: Record<string, unknown>  // inline params (alternative to configRef)
}
```

### Validation

Backend validates step configs at Pipeline creation time via zod schemas:

```typescript
const STEP_CONFIG_SCHEMAS = {
  filter: z.object({
    field: z.string(),
    operator: z.enum(["eq", "gt", "lt", "gte", "lte", "contains", "in"]),
    value: z.union([z.string(), z.number(), z.array(z.string())])
  }),
  rename: z.object({
    mappings: z.record(z.string(), z.string())
  }),
  compute: z.object({
    function: z.enum(["normalize_brand", "price_band"]),
    inputField: z.string(),
    outputField: z.string(),
    configRef: z.string().optional(),
    configVersion: z.number().int().positive().optional(),
    params: z.record(z.unknown()).optional()
  })
};
```

Invalid configs → 400 BadRequest at creation time, not worker failure at run time.

## Consequences

### Positive

- **Agent reliability**: LLM sees enum options, doesn't hallucinate config keys (same benefit as ADR-0026 Axis A)
- **Early validation**: Invalid Pipelines rejected at creation, not discovered hours later when a PipelineRun fails mid-batch
- **Tooling**: Frontend can render type-specific forms (brand mapping → key-value table, price bands → threshold inputs)
- **Backward compatibility**: Adding new step types or operators is schema evolution, not breaking change

### Negative

- **Limited expressiveness**: Complex logic (e.g., "filter by price > 100 AND brand = '美的'") requires multiple steps, not a single expression
- **Schema maintenance**: New transform types need code changes (add to enum + validator + worker handler)
- **No user-defined functions**: Cannot write custom transforms without backend deployment

## Alternatives Considered

### Alternative A: Free DSL expression

```typescript
{
  type: "dsl",
  config: {
    expression: "columns.price > 100 && columns.brand === '美的'"
  }
}
```

**Rejected because:**
- Requires designing/implementing a DSL interpreter (major engineering effort)
- LLM more likely to generate syntactically invalid expressions
- Debugging failures harder (DSL syntax errors vs structural config errors)
- Security: eval-like execution needs sandboxing

### Alternative B: JSON structure trees

```typescript
{
  type: "filter",
  config: {
    op: "and",
    conditions: [
      {op: "gt", field: "price", value: 100},
      {op: "eq", field: "brand", value: "美的"}
    ]
  }
}
```

**Rejected because:**
- Nested structure harder for LLM to generate correctly
- Frontend validation complex (recursive schema)
- Worker execution needs recursive evaluator
- Complexity not justified when "multiple single-condition steps" achieves same result

## Notes

- General expression DSL is not ruled out forever; revisit in V2 when we see real limitations
- The three MVP step types (filter/rename/compute) cover AVC's actual needs (brand normalization, price banding, invalid row filtering)
- Predefined compute functions are extensible: adding `function: "category_mapping"` is a 3-line change (enum + schema + worker case)
