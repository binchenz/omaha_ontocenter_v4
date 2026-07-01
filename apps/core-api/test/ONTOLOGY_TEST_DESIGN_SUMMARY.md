# OntologyTestCase Interface Design — Summary

## Design Request

Design a unified test harness for ontology evolution tests that:
- Supports both schema change tests and data query tests
- Reuses the delivery-report verdict pattern (anchor probe, ground truth, verdict fn)
- Handles ephemeral tenant lifecycle
- Supports multi-layer schema validation
- Extensible for 10+ scenarios

## Core Interface

```typescript
export interface OntologyTestCase {
  id: string;                           // e.g. "DERIVED-001", "DIM-002"
  title: string;                        // Human-readable description
  category: TestCategory;               // Which ontology aspect
  track: 'schema' | 'query' | 'agent';  // Verification strategy
  
  setup: (ctx: SetupContext) => Promise<SetupResult>;
  execute: (ctx: ExecuteContext) => Promise<ExecuteResult>;
  verify: (ctx: VerifyContext) => Promise<TestVerdict>;
}

export type TestCategory =
  | 'derived-field'         // ADR-0059: add field, backfill, verify visibility
  | 'dimension-constraint'  // ADR-0057: enforce required/default dims
  | 'relationship'          // Add ObjectRelation, verify joins
  | 'field-visibility'      // ADR-0035/36: field-level permissions
  | 'semantics'             // ADR-0061: additivity guard
  | 'pipeline'              // ADR-0060: multi-input alignment
  | 'metric-catalogue'      // ADR-0064: metric resolution
  | 'action'                // ADR-0048: declarative actions
  | 'computed-property'     // ADR-0048: Agent-written DSL
  | 'cross-tenant'          // Multi-tenant isolation
  ;
```

## Example Scenarios

### Scenario 1: DERIVED-001 (Add derived field)

**Category**: `derived-field`  
**Track**: `schema`  
**Tests**: ADR-0059's finding — adding a derived field requires 3 steps:
1. Update ObjectType.properties
2. Backfill existing instances
3. Refresh materialized view

**Setup**:
- Provision ephemeral tenant (slug = `ontology-test-${Date.now()}`)
- Create `product` ObjectType with fields: name, releaseDate, price
- Seed 3 instances with sample data

**Execute**:
- PATCH /ontology/types/product to add `year` field (formula: YEAR(releaseDate))
- Backfill all instances (update properties JSONB)
- Refresh matview: `REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_product"`

**Verify** (3 layers):
1. **Schema layer**: ObjectType.properties has `year:number` field
2. **Data layer**: All instances have non-null `year` value
3. **Matview layer**: `mv_product` has `year` column

**Verdict functions**:
```typescript
verifyFieldExists({ gt, tenantId, objectType, fieldName, expectedType })
verifyFieldBackfilled({ gt, tenantId, objectType, fieldName })
```

### Scenario 2: DIM-001 (Dimension constraint)

**Category**: `dimension-constraint`  
**Track**: `schema`  
**Tests**: ADR-0057's pattern — dimension with `required=true` + `defaultValue`

**Setup**:
- Provision ephemeral tenant
- Create `sales` ObjectType with fields: product, amount, month

**Execute**:
- PATCH /ontology/types/sales to add `region` dimension
- Set `required: true`, `defaultValue: "全国"`
- Set `allowedValues: ["全国", "华东", "华北", "华南", "西南"]`

**Verify**:
- Check ObjectType.properties has correct constraint metadata
- Verify `required === true` and `defaultValue === "全国"`

**Verdict function**:
```typescript
verifyDimensionConstraint({
  gt,
  tenantId,
  objectType,
  dimName,
  expectedRequired: true,
  expectedDefault: "全国"
})
```

## File Structure

```
apps/core-api/test/
├── ontology-test-case.ts              # Core interface + OntologyGroundTruth class
├── ontology-test-case-examples.ts     # 2 concrete examples (DERIVED-001, DIM-001)
├── ontology-harness.ts                # Shared orchestration (runOntologyTestCase)
├── ontology-verdict-helpers.ts        # Reusable verdict functions
├── ontology-test-scenarios/           # Extensible scenario catalog
│   ├── derived-field.scenarios.ts     # 3-5 derived field tests
│   ├── dimension-constraint.scenarios.ts
│   ├── relationship.scenarios.ts
│   ├── field-visibility.scenarios.ts
│   ├── semantics.scenarios.ts
│   ├── pipeline.scenarios.ts
│   ├── metric-catalogue.scenarios.ts
│   ├── action.scenarios.ts
│   ├── computed-property.scenarios.ts
│   ├── cross-tenant.scenarios.ts
│   └── index.ts                       # Export allScenarios array
└── ontology-harness.e2e-spec.ts       # Jest orchestration (runs all scenarios)
```

## Integration with Jest

### Pattern 1: Single test file (quick iteration)

```typescript
// test/ontology-derived-field.e2e-spec.ts
describe('Derived Field Tests', () => {
  let harness: OntologyTestHarness;

  beforeAll(async () => {
    harness = await createOntologyTestHarness();
  });

  afterAll(async () => {
    await harness.teardown();
  });

  it('DERIVED-001: Add year field', async () => {
    const verdict = await runOntologyTestCase(harness, DERIVED_FIELD_001);
    expect(verdict.pass).toBe(true);
  });
});
```

### Pattern 2: Unified harness (all scenarios)

```typescript
// test/ontology-harness.e2e-spec.ts
import { allScenarios } from './ontology-test-scenarios';

describe('Ontology Test Harness (e2e)', () => {
  let harness: OntologyTestHarness;

  beforeAll(async () => {
    harness = await createOntologyTestHarness();
  });

  afterAll(async () => {
    await harness.teardown();
  });

  allScenarios.forEach(scenario => {
    it(`${scenario.id}: ${scenario.title}`, async () => {
      const verdict = await runOntologyTestCase(harness, scenario);
      const mark = verdict.pass ? '✅' : '❌';
      console.log(`  ${mark} ${scenario.id} — ${scenario.title}`);
      expect(verdict.pass).toBe(true);
    }, 60_000);
  });
});
```

## OntologyGroundTruth Class (Independent SQL layer)

```typescript
export class OntologyGroundTruth {
  constructor(private readonly prisma: PrismaClient) {}

  // Schema queries
  async objectTypeExists(tenantId: string, name: string): Promise<boolean>
  async getFieldSchema(tenantId: string, objectType: string, fieldName: string): Promise<FieldSchema | null>
  async matviewHasColumn(tenantId: string, objectType: string, columnName: string): Promise<boolean>
  async getDimensionConstraint(tenantId: string, objectType: string, dimName: string): Promise<DimensionConstraint | null>
  async relationExists(tenantId: string, fromType: string, toType: string, name: string): Promise<boolean>

  // Data queries
  async queryInstances(tenantId: string, objectType: string, limit = 100): Promise<Array<Record<string, any>>>
  async instanceHasField(tenantId: string, objectType: string, instanceId: string, fieldName: string): Promise<boolean>
}
```

All queries use raw SQL with `$1::uuid` cast (same trap as delivery-report learned).

## Key Design Decisions

### 1. Ephemeral Tenant Lifecycle
- Each test provisions a **unique tenant** (slug = `ontology-test-${Date.now()}`)
- Tenant is **always cleaned up** in finally block
- No cross-contamination between tests
- Pattern: `provisionTenant(slug, name) → { tenantId, token }`

### 2. Pure Verdict Functions
- All verification uses **pure functions** (no LLM judges)
- Verdicts return `{ pass: boolean, detail: string }`
- Detail string is human-readable (surfaced in test reports)
- Reusable verdict helpers: `verifyFieldExists`, `verifyFieldBackfilled`, `verifyDimensionConstraint`

### 3. Independent Ground Truth
- `OntologyGroundTruth` uses **raw SQL** (bypasses DSL/query modules)
- Same anti-false-green discipline as delivery-report (ADR-0027)
- "The judge's ruler must not be built by the examinee"

### 4. Multi-Layer Verification
- Schema tests verify **3 layers**:
  1. ObjectType.properties JSON (field definition)
  2. Backfilled instance data (all rows have the field)
  3. Materialized view columns (Agent-visible schema)
- Prevents ADR-0059 trap (schema correct but matview stale)

### 5. Three Tracks
- **schema**: Verify DB structure (ObjectType, matview, constraints)
- **query**: Verify Agent's SQL generation + tool_result correctness
- **agent**: Verify Agent's final text answer (like delivery-report fact/behavior)

### 6. Extensibility
- 10 test categories predefined (covers all major ADRs)
- Easy to add scenarios: implement 3 functions (setup/execute/verify)
- No hardcoded tenant IDs (runtime discovery via anchors)

## Comparison to delivery-report

| Aspect | delivery-report | OntologyTestCase |
|--------|----------------|------------------|
| **Tenant** | Single real tenant (纯米) | Ephemeral per test |
| **Data** | Real AVC data (50 files) | Synthetic seeded data |
| **Tracks** | fact / behavior | schema / query / agent |
| **Verdict** | Pure functions | ✓ Same pattern |
| **Ground Truth** | Raw SQL (bypass DSL) | ✓ Same pattern |
| **Anchors** | Runtime probe | ✓ Same pattern |
| **Output** | Markdown report | Jest test results |

Both follow the same **3-phase architecture**:
1. Setup (provision + seed)
2. Execute (apply change or run query)
3. Verify (ground truth + pure verdict)

## Running the Tests

```bash
# Run all ontology tests
cd apps/core-api
npx jest ontology-harness.e2e-spec.ts --no-coverage

# Run a specific category
npx jest ontology-derived-field.e2e-spec.ts

# Run a single scenario
npx jest -t "DERIVED-001"
```

## Next Steps to Implement

1. **Create scenario catalog** (10 categories × 2-3 examples each = 20-30 scenarios)
2. **Extract verdict helpers** from examples into `ontology-verdict-helpers.ts`
3. **Build unified harness** (`ontology-harness.e2e-spec.ts`) that runs all scenarios
4. **Add CI integration** (run on every PR, report pass rate)
5. **Generate test report** (markdown summary like delivery-report, show coverage per category)

## Files Created

1. `/apps/core-api/test/ontology-test-case.ts` (308 lines)
   - Core interface definitions
   - OntologyGroundTruth class
   - Reusable verdict helpers

2. `/apps/core-api/test/ontology-test-case-examples.ts` (290 lines)
   - DERIVED-001: Add derived field example
   - DIM-001: Dimension constraint example
   - Jest integration pattern

3. `/apps/core-api/test/ONTOLOGY_TEST_CASE_INTEGRATION.md` (219 lines)
   - File structure recommendation
   - Harness helper implementation
   - How to add new scenarios

All code includes JSDoc comments and follows the delivery-report pattern.
