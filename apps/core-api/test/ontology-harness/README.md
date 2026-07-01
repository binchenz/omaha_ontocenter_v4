# Ontology Ground Truth — Phase 2.1 Implementation

## Overview

The **OntologyGroundTruth** class provides an independent SQL oracle for verifying Agent query results against raw `object_instances` data. This follows the ADR-0027 anti-false-green principle: the judge's ruler must not be built by the examinee.

## Design Pattern

Mirrors `delivery-report/ground-truth.ts`:
- Raw SQL via `$queryRawUnsafe` 
- Explicit `::uuid` casts for `tenant_id`
- Returns domain data (numbers, arrays) not raw rows
- Null-safe: returns `null` for missing data, never fabricates values

## Phase 2.1 Methods

### 1. `marketMetricValue`

Retrieve a single market metric value with filters.

**Signature:**
```typescript
async marketMetricValue(input: {
  tenantId: string;
  filters: Record<string, string>;
}): Promise<number | null>
```

**Example:**
```typescript
const value = await gt.marketMetricValue({
  tenantId: 'abc-123-uuid',
  filters: {
    category: '电饭煲',
    month: '2024-01',
    metric: '零售额'
  }
});
// Returns: 123456789.50 or null
```

**SQL Pattern:**
```sql
SELECT COALESCE(SUM((properties->>'value')::float8), 0) AS v
FROM object_instances
WHERE tenant_id = $1::uuid
  AND object_type = 'market_metric'
  AND deleted_at IS NULL
  AND properties->>'category' = $2
  AND properties->>'month' = $3
  AND properties->>'metric' = $4
```

### 2. `brandShareTopN`

Retrieve top N brands by share with ranking.

**Signature:**
```typescript
async brandShareTopN(input: {
  tenantId: string;
  category: string;
  period: string;
  limit: number;
  priceBand?: string;
  withValues?: boolean;
}): Promise<Array<string> | Array<{ brand: string; value: number }>>
```

**Example:**
```typescript
// With values
const brands = await gt.brandShareTopN({
  tenantId: 'abc-123-uuid',
  category: '电饭煲',
  period: '2024Q1',
  limit: 5,
  withValues: true
});
// Returns: [{brand: '小米', value: 0.25}, {brand: '美的', value: 0.20}, ...]

// Names only
const names = await gt.brandShareTopN({
  tenantId: 'abc-123-uuid',
  category: '电饭煲',
  period: '2024Q1',
  limit: 5,
  withValues: false
});
// Returns: ['小米', '美的', '九阳', ...]
```

**SQL Pattern:**
```sql
SELECT properties->>'brand' AS brand,
       MAX((properties->>'value')::float8) AS value
FROM object_instances
WHERE tenant_id = $1::uuid
  AND object_type = 'brand_share'
  AND deleted_at IS NULL
  AND properties->>'category' = $2
  AND properties->>'period' = $3
  AND properties->>'priceBand' = $4
GROUP BY properties->>'brand'
ORDER BY value DESC
LIMIT $5
```

### 3. `modelMetricTopN`

Retrieve top N models by metric value with ranking.

**Signature:**
```typescript
async modelMetricTopN(input: {
  tenantId: string;
  category: string;
  period: string;
  metricField: string;
  limit: number;
  withValues?: boolean;
}): Promise<Array<string> | Array<{ model: string; value: number }>>
```

**Example:**
```typescript
const models = await gt.modelMetricTopN({
  tenantId: 'abc-123-uuid',
  category: '电饭煲',
  period: '2024-01',
  metricField: 'valueShare',
  limit: 10,
  withValues: true
});
// Returns: [{model: 'MI-RCA-5L', value: 0.05}, {model: 'MD-X500', value: 0.04}, ...]
```

**SQL Pattern:**
```sql
SELECT properties->>'model' AS model,
       MAX((properties->>'${metricField}')::float8) AS value
FROM object_instances
WHERE tenant_id = $1::uuid
  AND object_type = 'model_metric'
  AND deleted_at IS NULL
  AND properties->>'category' = $2
  AND properties->>'month' = $3
GROUP BY properties->>'model'
ORDER BY value DESC
LIMIT $4
```

### 4. `timeSeries`

Retrieve time-ordered metric values over a period range.

**Signature:**
```typescript
async timeSeries(input: {
  tenantId: string;
  objectType: string;
  metricField: string;
  periodField: string;
  filters: Record<string, string>;
  startPeriod: string;
  endPeriod: string;
}): Promise<Array<{ period: string; value: number }>>
```

**Example:**
```typescript
const series = await gt.timeSeries({
  tenantId: 'abc-123-uuid',
  objectType: 'market_metric',
  metricField: 'value',
  periodField: 'month',
  filters: {
    category: '电饭煲',
    metric: '零售额'
  },
  startPeriod: '2023-01',
  endPeriod: '2023-12'
});
// Returns: [{period: '2023-01', value: 100000}, {period: '2023-02', value: 120000}, ...]
```

**SQL Pattern:**
```sql
SELECT properties->>'${periodField}' AS period,
       (properties->>'${metricField}')::float8 AS value
FROM object_instances
WHERE tenant_id = $1::uuid
  AND object_type = $2
  AND deleted_at IS NULL
  AND properties->>'${periodField}' >= $3
  AND properties->>'category' = $4
  AND properties->>'metric' = $5
  AND properties->>'${periodField}' <= '${endPeriod}'
ORDER BY properties->>'${periodField}'
```

## Null Safety

All methods handle missing data gracefully:

- `marketMetricValue`: Returns `null` when no data matches (not `0`, not throw)
- `brandShareTopN`: Returns empty array `[]` when no brands match
- `modelMetricTopN`: Returns empty array `[]` when no models match
- `timeSeries`: Returns empty array `[]` when no data in range

## Files

- **`ontology-ground-truth.ts`** - Main implementation
- **`ontology-ground-truth.examples.ts`** - Usage examples with mock data patterns
- **`ontology-ground-truth.e2e-spec.ts`** - E2E tests against real data (to be created)

## Testing

### Unit Tests (Mock Prisma)

See `ontology-ground-truth.examples.ts` for usage patterns with detailed mock behaviors.

### E2E Tests (Real Database)

E2E tests should be created following the pattern in `test/delivery-report/ground-truth.e2e-spec.ts`:

```typescript
describe('OntologyGroundTruth e2e', () => {
  let prisma: PrismaClient;
  let gt: OntologyGroundTruth;
  let tenantId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    gt = new OntologyGroundTruth(prisma);
    // Find tenant with data
  });

  it('marketMetricValue returns positive number', async () => {
    const value = await gt.marketMetricValue({...});
    expect(value).toBeGreaterThan(0);
  });
});
```

## Integration with Delivery Report Harness

This ground truth layer can be used in delivery report test harnesses to:

1. **Verify Agent query results** against raw SQL truth
2. **Check ranking correctness** (top-N brands/models)
3. **Validate time series data** (trends, growth calculations)
4. **Test cross-category aggregations** via `marketMetricValue` with multiple filters

Example integration:
```typescript
// In a delivery report test
const agentResult = await agent.query("电饭煲2024年1月零售额");
const groundTruth = await gt.marketMetricValue({
  tenantId,
  filters: { category: '电饭煲', month: '2024-01', metric: '零售额' }
});

expect(agentResult.value).toBeCloseTo(groundTruth, 2);
```

## Implementation Notes

### Dynamic Filter Building

`marketMetricValue` and `timeSeries` build WHERE clauses dynamically from filter objects:

```typescript
const filterKeys = Object.keys(input.filters);
const whereClauses = filterKeys.map((key, idx) => {
  return `properties->>'${key}' = $${idx + 2}`;
});
```

This allows flexible filtering without hardcoding column names.

### UUID Type Safety

All `tenant_id` parameters use explicit `::uuid` casts:

```sql
WHERE tenant_id = $1::uuid
```

This prevents type coercion errors and matches Prisma's UUID handling.

### MAX Aggregation in Top-N

`brandShareTopN` and `modelMetricTopN` use `MAX()` aggregation with `GROUP BY`:

```sql
SELECT properties->>'brand' AS brand,
       MAX((properties->>'value')::float8) AS value
FROM object_instances
GROUP BY properties->>'brand'
```

This handles cases where multiple rows exist for the same brand/model (shouldn't happen in clean data, but defensive).

### String-Based Period Comparison

`timeSeries` uses string comparison for period filtering:

```sql
WHERE properties->>'month' >= $3
  AND properties->>'month' <= '${endPeriod}'
```

This works for sortable period formats like `YYYY-MM` and `YYYYQN`. For complex date ranges, consider casting to proper date types.

## Future Extensions

Potential Phase 2.2+ methods:

- `aggregateMetric`: Generic aggregation with group-by dimensions
- `growthRate`: Calculate growth between two periods
- `rankingStability`: Compare top-N rankings across periods
- `coverageCheck`: Verify data completeness for period ranges
- `crossCategoryComparison`: Compare metrics across multiple categories

## Related

- **ADR-0027**: Anti-false-green testing principle
- **`delivery-report/ground-truth.ts`**: Original ground truth implementation
- **`schema-validation.ts`**: Schema change verification harness
