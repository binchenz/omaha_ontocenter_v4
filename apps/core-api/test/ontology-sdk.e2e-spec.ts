import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@omaha/db';
import {
  createTestApp,
  ensureTestTenant,
  loginAsTestTenantAdmin,
  cleanupTestTenant,
} from './test-helpers';
import { ViewManagerService } from '../src/modules/ontology/view-manager.service';

/**
 * Tests the OntologySdkService behavior through HTTP endpoints.
 * The SDK is exercised indirectly via /ontology/* and /query/* endpoints
 * which delegate to the same underlying services.
 */
describe('OntologySdk behavior (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let token: string;
  let viewManager: ViewManagerService;

  const TEST_TYPE_NAME = 'sdk_test_item';

  beforeAll(async () => {
    app = await createTestApp();
    tenantId = await ensureTestTenant(app);
    token = await loginAsTestTenantAdmin(app);
    prisma = new PrismaClient();
    viewManager = app.get(ViewManagerService);

    // Clean up from previous runs
    await prisma.objectInstance.deleteMany({ where: { tenantId, objectType: TEST_TYPE_NAME } });
    const existing = await prisma.objectType.findFirst({ where: { tenantId, name: TEST_TYPE_NAME } });
    if (existing) {
      await prisma.objectRelationship.deleteMany({
        where: { tenantId, OR: [{ sourceTypeId: existing.id }, { targetTypeId: existing.id }] },
      });
      await prisma.objectType.delete({ where: { id: existing.id } });
    }
  });

  afterAll(async () => {
    await prisma.objectInstance.deleteMany({ where: { tenantId, objectType: TEST_TYPE_NAME } });
    const leftover = await prisma.objectType.findFirst({ where: { tenantId, name: TEST_TYPE_NAME } });
    if (leftover) {
      await prisma.objectRelationship.deleteMany({
        where: { tenantId, OR: [{ sourceTypeId: leftover.id }, { targetTypeId: leftover.id }] },
      });
      await prisma.objectType.delete({ where: { id: leftover.id } });
    }
    await cleanupTestTenant(app);
    await prisma.$disconnect();
    await app.close();
  });

  describe('getSchema (GET /ontology/types)', () => {
    it('returns types array for the tenant', async () => {
      const res = await request(app.getHttpServer())
        .get('/ontology/types')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      // Test tenant starts empty — just verify the shape
    });
  });

  describe('createObjectType (POST /ontology/types)', () => {
    it('creates a new type that appears in listing', async () => {
      await request(app.getHttpServer())
        .post('/ontology/types')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: TEST_TYPE_NAME,
          label: 'SDK Test Item',
          properties: [
            { name: 'title', type: 'string', label: 'Title', filterable: true, sortable: true },
            { name: 'amount', type: 'number', label: 'Amount', filterable: true },
          ],
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/ontology/types')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const created = res.body.find((t: any) => t.name === TEST_TYPE_NAME);
      expect(created).toBeDefined();
      expect(created.label).toBe('SDK Test Item');
      expect(created.properties).toHaveLength(2);
    });
  });

  describe('updateObjectType (PATCH /ontology/types/:id)', () => {
    it('changes label and properties', async () => {
      const type = await prisma.objectType.findFirst({ where: { tenantId, name: TEST_TYPE_NAME } });

      await request(app.getHttpServer())
        .put(`/ontology/types/${type!.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          label: 'SDK Test Item (Updated)',
          properties: [
            { name: 'title', type: 'string', label: 'Title', filterable: true, sortable: true },
            { name: 'amount', type: 'number', label: 'Amount', filterable: true },
            { name: 'status', type: 'string', label: 'Status', filterable: true },
          ],
        })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/ontology/types')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const updated = res.body.find((t: any) => t.name === TEST_TYPE_NAME);
      expect(updated.label).toBe('SDK Test Item (Updated)');
      expect(updated.properties).toHaveLength(3);
    });
  });

  describe('queryObjects (POST /query/objects)', () => {
    beforeAll(async () => {
      await prisma.objectInstance.createMany({
        data: [
          { tenantId, objectType: TEST_TYPE_NAME, externalId: 'SDK-Q-001', properties: { title: 'Item A', amount: 100, status: 'active' }, relationships: {} },
          { tenantId, objectType: TEST_TYPE_NAME, externalId: 'SDK-Q-002', properties: { title: 'Item B', amount: 200, status: 'inactive' }, relationships: {} },
          { tenantId, objectType: TEST_TYPE_NAME, externalId: 'SDK-Q-003', properties: { title: 'Item C', amount: 300, status: 'active' }, relationships: {} },
        ],
      });
      // Refresh view so seeded instances are visible
      await viewManager.refresh(tenantId, TEST_TYPE_NAME);
    });

    it('returns instances matching filters', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/objects')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: TEST_TYPE_NAME,
          filters: [{ field: 'status', operator: 'eq', value: 'active' }],
        })
        .expect(201);

      expect(res.body.data).toHaveLength(2);
      const titles = res.body.data.map((d: any) => d.properties.title);
      expect(titles).toContain('Item A');
      expect(titles).toContain('Item C');
    });

    it('returns all instances with no filter', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/objects')
        .set('Authorization', `Bearer ${token}`)
        .send({ objectType: TEST_TYPE_NAME })
        .expect(201);

      expect(res.body.data).toHaveLength(3);
      expect(res.body.meta.total).toBe(3);
    });
  });

  describe('deleteObjectType (DELETE /ontology/types/:id)', () => {
    it('removes the type definition', async () => {
      const type = await prisma.objectType.findFirst({ where: { tenantId, name: TEST_TYPE_NAME } });

      await request(app.getHttpServer())
        .delete(`/ontology/types/${type!.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Type should be gone
      const typeAfter = await prisma.objectType.findFirst({ where: { tenantId, name: TEST_TYPE_NAME } });
      expect(typeAfter).toBeNull();
    });
  });

  describe('tenant isolation', () => {
    it('queries on one tenant do not return another tenant data', async () => {
      // The demo tenant has data; our test tenant should not see it
      const demoTenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: 'demo' } })).id;

      const resTest = await request(app.getHttpServer())
        .post('/query/objects')
        .set('Authorization', `Bearer ${token}`)
        .send({ objectType: 'customer' })
        .expect(201);

      // Test tenant should have no customers (we never created any for this tenant)
      // All customer data belongs to demo tenant
      for (const item of resTest.body.data) {
        // If any data comes back, it must belong to our test tenant
        const instance = await prisma.objectInstance.findUnique({ where: { id: item.id } });
        expect(instance!.tenantId).toBe(tenantId);
      }
    });
  });
});
