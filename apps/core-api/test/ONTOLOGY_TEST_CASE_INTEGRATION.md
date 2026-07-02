# OntologyTestCase Interface — File Structure & Integration

## Overview

The `OntologyTestCase` interface provides a unified harness for testing ontology evolution (schema changes + data queries) in ephemeral tenants. It reuses the **delivery-report verdict pattern**: anchor probe → ground truth → pure verdict functions.

## File Structure

```
apps/core-api/test/
├── ontology-test-case.ts              # Core interface + types + ground truth oracle
├── ontology-test-case-examples.ts     # 2 concrete scenarios (DERIVED-001, DIM-001)
├── ontology-test-scenarios/           # Extensible scenario catalog
│   ├── derived-field.scenarios.ts     # 3-5 derived field test cases
│   ├── dimension-constraint.scenarios.ts
│   ├── relationship.scenarios.ts
│   ├── field-visibility.scenarios.ts
│   ├── semantics.scenarios.ts
│   ├── pipeline.scenarios.ts
│   ├── metric-catalogue.scenarios.ts
│   ├── action.scenarios.ts
│   ├── computed-property.scenarios.ts
│   └── cross-tenant.scenarios.ts
├── ontology-harness.e2e-spec.ts       # Jest orchestration (runs all scenarios)
└── ontology-verdict-helpers.ts        # Reusable verdict functions
```

## Integration with Jest

### Pattern 1: Single-file test (for quick iteration)

```typescript
// test/ontology-derived-field.e2e-spec.ts
import { DERIVED_FIELD_001, DERIVED_FIELD_002 } from './ontology-test-scenarios/derived-field.scenarios';
import { runOntologyTestCase } from './ontology-harness';

describe('Derived Field Tests (e2e)', () => {
  let harness: OntologyTestHarness;

  beforeAll(async () => {
    harness = await createOntologyTestHarness();
  });

  afterAll(async () => {
    await harness.teardown();
  });

  it('DERIVED-001: Add year field to existing product data', async () => {
    const verdict = await runOntologyTestCase(harness, DERIVED_FIELD_001);
    expect(verdict.pass).toBe(true);
  });

  it('DERIVED-002: Add computed profit margin field', async () => {
    const verdict = await runOntologyTestCase(harness, DERIVED_FIELD_002);
    expect(verdict.pass).toBe(true);
  });
});
```

### Pattern 2: Unified harness (runs all scenarios, like delivery-report)

```typescript
// test/ontology-harness.e2e-spec.ts
import { allScenarios } from './ontology-test-scenarios';

describe('Ontology Test Harness — all scenarios (e2e)', () => {
  let harness: OntologyTestHarness;

  beforeAll(async () => {
    harness = await createOntologyTestHarness();
  });

  afterAll(async () => {
    await harness.teardown();
  });

  // Dynamically generate one Jest test per scenario
  allScenarios.forEach(scenario => {
    it(`${scenario.id}: ${scenario.title}`, async () => {
      const verdict = await runOntologyTestCase(harness, scenario);
      
      // Log progress (like delivery-report)
      const mark = verdict.pass ? '✅' : '❌';
      console.log(`  ${mark} ${scenario.id} — ${scenario.title}`);
      
      expect(verdict.pass).toBe(true);
    }, 60_000); // 60s timeout per scenario
  });
});
```

## Harness Helper (shared orchestration logic)

```typescript
// test/ontology-harness.ts
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@omaha/db';
import { OntologyTestCase, TestVerdict } from './ontology-test-case';
import { createTestApp } from './test-helpers';
import * as bcrypt from 'bcrypt';
import request from 'supertest';

export interface OntologyTestHarness {
  app: INestApplication;
  prisma: PrismaClient;
  teardown: () => Promise<void>;
}

export async function createOntologyTestHarness(): Promise<OntologyTestHarness> {
  const app = await createTestApp();
  const prisma = new PrismaClient();
  return {
    app,
    prisma,
    async teardown() {
      await prisma.$disconnect();
      await app.close();
    },
  };
}

/**
 * Run a single OntologyTestCase: setup → execute → verify → cleanup.
 * Ephemeral tenant is created and destroyed within this function.
 */
export async function runOntologyTestCase(
  harness: OntologyTestHarness,
  testCase: OntologyTestCase,
): Promise<TestVerdict> {
  const { app, prisma } = harness;

  // Helper to provision ephemeral tenant
  async function provisionTenant(slug: string, name: string) {
    await prisma.tenant.deleteMany({ where: { slug } });
    const tenant = await prisma.tenant.create({ data: { slug, name } });
    const adminRole = await prisma.role.create({
      data: { tenantId: tenant.id, name: 'admin', permissions: ['*'] },
    });
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `admin@${slug}.test`,
        name: 'Admin',
        passwordHash: await bcrypt.hash('test123', 10),
        roleId: adminRole.id,
      },
    });

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: 'test123', tenantSlug: slug })
      .expect(201);

    return { tenantId: tenant.id, token: res.body.accessToken };
  }

  // Setup
  const setupResult = await testCase.setup({ app, prisma, provisionTenant });

  try {
    // Execute
    const executeResult = await testCase.execute({ ...setupResult, app, prisma });

    // Verify
    const verdict = await testCase.verify({
      ...executeResult,
      ...setupResult,
      prisma,
      groundTruth: new OntologyGroundTruth(prisma),
    });

    return verdict;
  } finally {
    // Cleanup ephemeral tenant (always runs, even if verify throws)
    await cleanupTenant(prisma, setupResult.tenantId);
  }
}

async function cleanupTenant(prisma: PrismaClient, tenantId: string) {
  await prisma.objectInstance.deleteMany({ where: { tenantId } });
  await prisma.objectRelationship.deleteMany({ where: { tenantId } });
  await prisma.objectType.deleteMany({ where: { tenantId } });
  await prisma.connector.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.role.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  // Note: matviews are dropped automatically when ObjectType is deleted
  // (ViewManagerService hooks into deletion lifecycle)
}
```

## Adding New Scenarios

To add a new test scenario, create it in the appropriate file under `ontology-test-scenarios/`:

```typescript
// test/ontology-test-scenarios/relationship.scenarios.ts
import { OntologyTestCase } from '../ontology-test-case';

export const RELATIONSHIP_001: OntologyTestCase = {
  id: 'REL-001',
  title: 'Add one-to-many relationship (order → order_items)',
  category: 'relationship',
  track: 'schema',

  async setup(ctx) {
    // Provision tenant, create two ObjectTypes (order, order_item)
    // ...
  },

  async execute(ctx) {
    // POST /ontology/relations to create the relationship
    // ...
  },

  async verify(ctx) {
    // Verify the relationship exists in DB + Agent can join-query
    // ...
  },
};
```

Then export it from the index:

```typescript
// test/ontology-test-scenarios/index.ts
export * from './derived-field.scenarios';
export * from './dimension-constraint.scenarios';
export * from './relationship.scenarios';
// ... etc

import { DERIVED_FIELD_001, DERIVED_FIELD_002 } from './derived-field.scenarios';
import { DIMENSION_CONSTRAINT_001 } from './dimension-constraint.scenarios';
import { RELATIONSHIP_001 } from './relationship.scenarios';

export const allScenarios = [
  DERIVED_FIELD_001,
  DERIVED_FIELD_002,
  DIMENSION_CONSTRAINT_001,
  RELATIONSHIP_001,
  // Add more as you build them
];
```

## Key Design Decisions

### 1. Ephemeral Tenant Lifecycle
- Each test case provisions a **unique tenant** (slug = `ontology-test-${Date.now()}`)
- Tenant is **always cleaned up** in finally block (no cross-contamination)
- Same pattern as `scenario-multi-tenant.e2e-spec.ts`

### 2. Pure Verdict Functions
- All verification logic is **pure functions** (no LLM judges)
- Verdicts are **auditable**: pass/fail + human-readable detail string
- Reusable verdict helpers in `ontology-verdict-helpers.ts`

### 3. Independent Ground Truth
- `OntologyGroundTruth` class uses **raw SQL** (bypasses DSL/query modules)
- Same anti-false-green discipline as delivery-report (ADR-0027)
- All queries cast `tenant_id::uuid` (learned from delivery-report)

### 4. Multi-Layer Verification
- Schema tests verify **3 layers**:
  1. ObjectType.properties JSON (field definition)
  2. Backfilled instance data (all rows have the field)
  3. Materialized view columns (Agent-visible schema)
- This prevents the ADR-0059 trap (schema correct but matview stale)

### 5. Extensibility
- 10 test categories predefined (derived-field, dimension-constraint, etc.)
- Easy to add new scenarios: just implement the 3 functions (setup/execute/verify)
- No hardcoded tenant IDs (runtime discovery via anchors)

## Running the Tests

```bash
# Run all ontology tests
cd apps/core-api
npx jest ontology-harness.e2e-spec.ts --no-coverage

# Run a specific category
npx jest ontology-derived-field.e2e-spec.ts

# Run a single scenario (by test name pattern)
npx jest -t "DERIVED-001"
```

## Comparison to delivery-report

| Aspect | delivery-report | OntologyTestCase |
|--------|----------------|------------------|
| **Tenant** | Single real tenant (纯米) | Ephemeral per test |
| **Data** | Real AVC data (50 Excel files) | Synthetic seeded data |
| **Tracks** | fact / behavior | schema / query / agent |
| **Verdict** | Pure functions (no LLM judge) | ✓ Same pattern |
| **Ground Truth** | Raw SQL (bypasses DSL) | ✓ Same pattern |
| **Anchors** | Runtime probe (categories/periods) | ✓ Same pattern |
| **Report Output** | Markdown report | Jest test results |

Both follow the same **3-phase architecture**: setup → execute → verify, with pure verdict functions and independent ground truth.
