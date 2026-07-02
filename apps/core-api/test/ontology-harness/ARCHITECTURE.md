# Ontology Ground Truth Architecture

## Layer Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Delivery Report Harness                  │
│  (Verify Agent results against independent ground truth)    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────────┐
│              OntologyGroundTruth (Phase 2.1)                │
│  ┌──────────────┬──────────────┬──────────────┬──────────┐ │
│  │ market       │ brandShare   │ modelMetric  │ time     │ │
│  │ MetricValue  │ TopN         │ TopN         │ Series   │ │
│  └──────────────┴──────────────┴──────────────┴──────────┘ │
└────────────────────┬────────────────────────────────────────┘
                     │ Raw SQL ($queryRawUnsafe)
                     ↓
┌─────────────────────────────────────────────────────────────┐
│                    Prisma Client                            │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────────┐
│              PostgreSQL: object_instances                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ id, tenant_id, object_type, properties (JSONB), ...  │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

### Query Path: Agent vs Ground Truth

```
User Question: "电饭煲2024年1月零售额是多少？"
                         │
                ┌────────┴────────┐
                ↓                 ↓
         ┌────────────┐    ┌────────────────┐
         │   Agent    │    │ Ground Truth   │
         │   (Test)   │    │   (Oracle)     │
         └─────┬──────┘    └────────┬───────┘
               │                    │
         Agent DSL             Raw SQL
         QueryPlanner      $queryRawUnsafe
         Aggregate Tool          │
               │                 │
               ↓                 ↓
         ┌──────────────────────────┐
         │   object_instances       │
         └──────────────────────────┘
               │                 │
               ↓                 ↓
         123,456,789.5      123,456,789.5
               │                 │
               └────────┬────────┘
                        ↓
                  ✅ Match: PASS
```

## Method Mapping

### 1. marketMetricValue

```
Input: { tenantId, filters: { category, month, metric } }
  ↓
SQL: SELECT SUM(properties->>'value')
     FROM object_instances
     WHERE object_type = 'market_metric'
       AND properties->>'category' = $category
       AND properties->>'month' = $month
       AND properties->>'metric' = $metric
  ↓
Output: number | null
```

### 2. brandShareTopN

```
Input: { tenantId, category, period, limit, priceBand? }
  ↓
SQL: SELECT properties->>'brand',
            MAX(properties->>'value')
     FROM object_instances
     WHERE object_type = 'brand_share'
       AND properties->>'category' = $category
       AND properties->>'period' = $period
       AND properties->>'priceBand' = $priceBand
     GROUP BY properties->>'brand'
     ORDER BY value DESC
     LIMIT $limit
  ↓
Output: string[] | { brand, value }[]
```

### 3. modelMetricTopN

```
Input: { tenantId, category, period, metricField, limit }
  ↓
SQL: SELECT properties->>'model',
            MAX(properties->>'${metricField}')
     FROM object_instances
     WHERE object_type = 'model_metric'
       AND properties->>'category' = $category
       AND properties->>'month' = $period
     GROUP BY properties->>'model'
     ORDER BY value DESC
     LIMIT $limit
  ↓
Output: string[] | { model, value }[]
```

### 4. timeSeries

```
Input: { tenantId, objectType, metricField, periodField,
         filters, startPeriod, endPeriod }
  ↓
SQL: SELECT properties->>'${periodField}' AS period,
            properties->>'${metricField}' AS value
     FROM object_instances
     WHERE object_type = $objectType
       AND properties->>'${periodField}' >= $startPeriod
       AND properties->>'${periodField}' <= $endPeriod
       AND <dynamic filters>
     ORDER BY properties->>'${periodField}'
  ↓
Output: { period, value }[]
```

## Independence Guarantee (ADR-0027)

```
┌──────────────────────────────────────────────────────────┐
│                    Agent Code Path                       │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Skills → QueryPlanner → DSL → Aggregate Tool   │    │
│  └─────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
                         ❌ NO SHARED CODE
┌──────────────────────────────────────────────────────────┐
│              Ground Truth Code Path                      │
│  ┌─────────────────────────────────────────────────┐    │
│  │ OntologyGroundTruth → $queryRawUnsafe → SQL    │    │
│  └─────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

**Key principle**: If both paths produce the same answer, the Agent's implementation is correct. If they differ, the ground truth is definitionally correct.

## Usage in Tests

### Pattern 1: Single Value Verification

```typescript
test('Agent returns correct market size', async () => {
  // Agent path
  const agentResult = await agent.query("电饭煲2024年1月零售额");
  
  // Ground truth path
  const truth = await gt.marketMetricValue({
    tenantId,
    filters: { category: '电饭煲', month: '2024-01', metric: '零售额' }
  });
  
  // Verify
  expect(agentResult.value).toBeCloseTo(truth, 2);
});
```

### Pattern 2: Ranking Verification

```typescript
test('Agent returns correct brand ranking', async () => {
  // Agent path
  const agentResult = await agent.query("电饭煲2024Q1市场份额前5品牌");
  
  // Ground truth path
  const truth = await gt.brandShareTopN({
    tenantId,
    category: '电饭煲',
    period: '2024Q1',
    limit: 5,
    withValues: false
  });
  
  // Verify order
  expect(agentResult.brands).toEqual(truth);
});
```

### Pattern 3: Time Series Verification

```typescript
test('Agent returns correct trend data', async () => {
  // Agent path
  const agentResult = await agent.query("电饭煲2023年全年零售额趋势");
  
  // Ground truth path
  const truth = await gt.timeSeries({
    tenantId,
    objectType: 'market_metric',
    metricField: 'value',
    periodField: 'month',
    filters: { category: '电饭煲', metric: '零售额' },
    startPeriod: '2023-01',
    endPeriod: '2023-12'
  });
  
  // Verify series
  expect(agentResult.series).toEqual(truth);
});
```

## Extension Points

### Phase 2.2+ Candidates

```
Current (Phase 2.1)          Future (Phase 2.2+)
├── marketMetricValue     →  ├── aggregateMetric (generic)
├── brandShareTopN        →  ├── rankingStability (cross-period)
├── modelMetricTopN       →  ├── growthRate (period comparison)
└── timeSeries            →  ├── coverageCheck (data completeness)
                             └── crossCategoryComparison
```

## File Organization

```
test/ontology-harness/
├── ontology-ground-truth.ts           ← Core implementation
├── ontology-ground-truth.examples.ts  ← Usage patterns
├── ontology-ground-truth.e2e-spec.ts  ← E2E tests (future)
├── README.md                          ← API docs
├── ARCHITECTURE.md                    ← This file
├── IMPLEMENTATION_SUMMARY.md          ← Implementation notes
└── schema-validation.ts               ← Schema checks (orthogonal)
```

## Related Components

- **`delivery-report/ground-truth.ts`**: Original pattern source
- **`schema-validation.ts`**: Verifies schema propagation (orthogonal concern)
- **Agent Skills**: The code being tested (separate path)
- **QueryPlanner**: Agent's DSL implementation (separate path)
