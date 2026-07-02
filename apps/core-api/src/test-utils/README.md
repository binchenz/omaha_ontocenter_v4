# Test Utilities

Ephemeral tenant harness for safe test isolation with automatic cleanup.

## Files

- **ephemeral-tenant.ts** - Core functions for creating and cleaning up test tenants
- **test-tenant.ts** - Helper for provisioning tenants with ObjectType schemas
- **ephemeral-tenant.spec.ts** - Integration tests demonstrating usage patterns

## Quick Start

### Pattern 1: beforeEach/afterEach

Use when multiple tests share the same tenant structure:

```typescript
import { createEphemeralTenant, cleanupTenant } from './test-utils/ephemeral-tenant';
import { PrismaService } from '@omaha/db';

describe('My Feature', () => {
  let prisma: PrismaService;
  let tenantCtx: EphemeralTenantContext;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  beforeEach(async () => {
    tenantCtx = await createEphemeralTenant(prisma);
  });

  afterEach(async () => {
    await cleanupTenant(prisma, tenantCtx.tenant.id);
  });

  it('should test something', async () => {
    // Use tenantCtx.tenant, tenantCtx.adminUser, etc.
  });
});
```

### Pattern 2: withEphemeralTenant HOF

Use for single-test scope with guaranteed cleanup:

```typescript
import { withEphemeralTenant } from './test-utils/ephemeral-tenant';

it('should test something', async () => {
  await withEphemeralTenant(prisma, async (ctx) => {
    // Use ctx.tenant, ctx.adminUser, etc.
    // Cleanup happens automatically, even if test throws
  });
});
```

### Pattern 3: ensureTestTenantWithSchema

Use when tests require specific ObjectType schemas:

```typescript
import { ensureTestTenantWithSchema } from './test-utils/test-tenant';
import { cleanupTenant } from './test-utils/ephemeral-tenant';

it('should test with schema', async () => {
  const ctx = await ensureTestTenantWithSchema(
    prisma,
    [
      {
        name: 'Product',
        label: 'Product',
        properties: [
          { name: 'SKU', externalId: 'sku', dataType: 'string', isPrimaryKey: true },
          { name: 'Price', externalId: 'price', dataType: 'number' },
        ],
      },
    ],
  );

  try {
    // Use ctx.tenant, ctx.objectTypes, etc.
  } finally {
    await cleanupTenant(prisma, ctx.tenant.id);
  }
});
```

## Features

### Collision-Resistant Naming

Tenant slugs use format `test-{timestamp}-{random6}` to prevent collisions across parallel test runs.

### Safe Cleanup Order

Follows FK dependency order:
1. DatasetRows → Datasets
2. ObjectInstances
3. ObjectMappings
4. PipelineRuns → Pipelines
5. ObjectTypes
6. Users → Roles
7. Conversations
8. Tenant

### Idempotent Cleanup

`cleanupTenant` logs but doesn't throw if tenant is already deleted.

### Standard Roles

Each tenant gets three roles:
- **owner**: Full permissions (tenant.admin, object.*, data.import, conversation.create)
- **operator**: Query + write (object.read, object.query, object.write, conversation.create)
- **viewer**: Read-only (object.read, object.query, conversation.create)

## Context Interface

```typescript
interface EphemeralTenantContext {
  tenant: Tenant;
  adminUser: User;
  ownerRoleId: string;
  operatorRoleId: string;
  viewerRoleId: string;
}
```

## Test Results

All 8 integration tests pass (9.4s):
- ✓ Tenant provisioning with collision-resistant slugs
- ✓ Three standard roles creation
- ✓ Admin user assignment to owner role
- ✓ ObjectType creation
- ✓ Auto-cleanup on test failure
- ✓ Schema provisioning
- ✓ Concurrent tenant handling
- ✓ ensureTestTenantWithSchema helper
