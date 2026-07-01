/**
 * Integration tests demonstrating ephemeral tenant patterns
 *
 * Pattern 1: beforeEach/afterEach with cleanup tracking
 * Pattern 2: withEphemeralTenant HOF for single-test scope
 */

import { PrismaService } from '@omaha/db';
import {
  createEphemeralTenant,
  cleanupTenant,
  withEphemeralTenant,
  EphemeralTenantContext,
} from './ephemeral-tenant';
import { ensureTestTenantWithSchema } from './test-tenant';

describe('Ephemeral Tenant Patterns', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /**
   * Pattern 1: beforeEach/afterEach with cleanup tracking
   *
   * Use when:
   * - Multiple tests share the same tenant structure
   * - You need to inspect tenant state after test failure
   * - Tests are independent (each gets fresh tenant)
   */
  describe('Pattern 1: beforeEach/afterEach', () => {
    let tenantCtx: EphemeralTenantContext;

    beforeEach(async () => {
      tenantCtx = await createEphemeralTenant(prisma, {
        tenantName: 'Pattern 1 Test Tenant',
      });
    });

    afterEach(async () => {
      if (tenantCtx?.tenant?.id) {
        await cleanupTenant(prisma, tenantCtx.tenant.id);
      }
    });

    it('should provision tenant with admin user', async () => {
      expect(tenantCtx.tenant).toBeDefined();
      expect(tenantCtx.tenant.slug).toMatch(/^test-\d+-[a-f0-9]{6}$/);
      expect(tenantCtx.adminUser).toBeDefined();
      expect(tenantCtx.adminUser.email).toContain('@test.local');
    });

    it('should create three standard roles', async () => {
      const roles = await prisma.role.findMany({
        where: { tenantId: tenantCtx.tenant.id },
      });

      expect(roles).toHaveLength(3);
      expect(roles.map((r: { name: string }) => r.name).sort()).toEqual([
        'operator',
        'owner',
        'viewer',
      ]);
    });

    it('should assign admin user to owner role', async () => {
      const user = await prisma.user.findUnique({
        where: { id: tenantCtx.adminUser.id },
        include: { role: true },
      });

      expect(user).toBeDefined();
      expect(user!.role.name).toBe('owner');
      expect(user!.roleId).toBe(tenantCtx.ownerRoleId);
    });

    it('should allow creating ObjectTypes for the tenant', async () => {
      const objectType = await prisma.objectType.create({
        data: {
          name: 'Product',
          label: 'Product',
          tenantId: tenantCtx.tenant.id,
          properties: [
            {
              name: 'SKU',
              externalId: 'sku',
              dataType: 'string',
              isPrimaryKey: true,
            },
            {
              name: 'Price',
              externalId: 'price',
              dataType: 'number',
            },
          ],
        },
      });

      expect(objectType.id).toBeDefined();
      expect(Array.isArray(objectType.properties)).toBe(true);
      expect((objectType.properties as any[]).length).toBe(2);
    });
  });

  /**
   * Pattern 2: withEphemeralTenant HOF
   *
   * Use when:
   * - Test is self-contained (single assertion)
   * - Guaranteed cleanup is critical (even if test throws)
   * - You want minimal boilerplate
   */
  describe('Pattern 2: withEphemeralTenant HOF', () => {
    it('should auto-cleanup even if test throws', async () => {
      let capturedTenantId: string | undefined;

      try {
        await withEphemeralTenant(prisma, async (ctx) => {
          capturedTenantId = ctx.tenant.id;

          // Verify tenant exists during test
          const tenant = await prisma.tenant.findUnique({
            where: { id: ctx.tenant.id },
          });
          expect(tenant).toBeDefined();

          // Simulate test failure
          throw new Error('Simulated test failure');
        });
      } catch (error: unknown) {
        expect((error as Error).message).toBe('Simulated test failure');
      }

      // Verify cleanup happened despite throw
      const cleanedTenant = await prisma.tenant.findUnique({
        where: { id: capturedTenantId! },
      });
      expect(cleanedTenant).toBeNull();
    });

    it('should support tenant provisioning with schema', async () => {
      await withEphemeralTenant(prisma, async (ctx) => {
        // Create ObjectType inside the HOF scope
        const objectType = await prisma.objectType.create({
          data: {
            name: 'Customer',
            label: 'Customer',
            tenantId: ctx.tenant.id,
            properties: [
              {
                name: 'Customer ID',
                externalId: 'customer_id',
                dataType: 'string',
                isPrimaryKey: true,
              },
              {
                name: 'LTV',
                externalId: 'ltv',
                dataType: 'number',
              },
            ],
          },
        });

        // Verify schema exists
        const retrieved = await prisma.objectType.findUnique({
          where: { id: objectType.id },
        });
        expect(retrieved).toBeDefined();
        expect(Array.isArray(retrieved!.properties)).toBe(true);
        expect((retrieved!.properties as any[]).length).toBe(2);
      });
      // Implicit cleanup via HOF finally block
    });

    it('should handle concurrent ephemeral tenants', async () => {
      // Spawn 3 concurrent tenants
      const results = await Promise.all([
        withEphemeralTenant(prisma, async (ctx) => ctx.tenant.slug),
        withEphemeralTenant(prisma, async (ctx) => ctx.tenant.slug),
        withEphemeralTenant(prisma, async (ctx) => ctx.tenant.slug),
      ]);

      // All slugs should be unique (collision-resistant)
      const uniqueSlugs = new Set(results);
      expect(uniqueSlugs.size).toBe(3);

      // All slugs should match format
      results.forEach((slug: string) => {
        expect(slug).toMatch(/^test-\d+-[a-f0-9]{6}$/);
      });
    });
  });

  /**
   * Pattern 3: ensureTestTenantWithSchema helper
   *
   * Use when:
   * - Tests require specific ObjectType schemas
   * - You want declarative schema setup
   */
  describe('Pattern 3: ensureTestTenantWithSchema', () => {
    it('should create tenant with ObjectType schemas', async () => {
      const ctx = await ensureTestTenantWithSchema(
        prisma,
        [
          {
            name: 'Order',
            label: 'Order',
            properties: [
              {
                name: 'Order ID',
                externalId: 'order_id',
                dataType: 'string',
                isPrimaryKey: true,
              },
              {
                name: 'Total',
                externalId: 'total',
                dataType: 'number',
                isRequired: true,
              },
            ],
          },
          {
            name: 'LineItem',
            label: 'Line Item',
            properties: [
              {
                name: 'Line Item ID',
                externalId: 'line_item_id',
                dataType: 'string',
                isPrimaryKey: true,
              },
              {
                name: 'Quantity',
                externalId: 'quantity',
                dataType: 'integer',
              },
            ],
          },
        ],
        {
          tenantName: 'E-commerce Test Tenant',
        },
      );

      try {
        // Verify tenant context
        expect(ctx.tenant).toBeDefined();
        expect(ctx.adminUser).toBeDefined();
        expect(ctx.objectTypes).toHaveLength(2);

        // Verify ObjectTypes were created
        const [order, lineItem] = ctx.objectTypes;
        expect(order.name).toBe('Order');
        expect(lineItem.name).toBe('LineItem');

        // Verify properties are persisted
        const orderType = await prisma.objectType.findUnique({
          where: { id: order.id },
        });
        expect(orderType).toBeDefined();
        expect(Array.isArray(orderType!.properties)).toBe(true);
        expect((orderType!.properties as any[]).length).toBe(2);
        expect((orderType!.properties as any[])[0].isPrimaryKey).toBe(true);
      } finally {
        await cleanupTenant(prisma, ctx.tenant.id);
      }
    });
  });
});
