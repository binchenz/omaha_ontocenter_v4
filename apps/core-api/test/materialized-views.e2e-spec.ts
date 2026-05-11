import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@omaha/db';
import { createTestApp, ensureTestTenant, loginAsTestTenantAdmin, cleanupTestTenant } from './test-helpers';
import { ViewManagerService } from '../src/modules/ontology/view-manager.service';

describe('Materialized views (e2e)', () => {
  jest.setTimeout(30_000);
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let token: string;
  let viewManager: ViewManagerService;

  const TEST_TYPE = 'mv_test_product';

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaClient();
    tenantId = await ensureTestTenant(app);
    token = await loginAsTestTenantAdmin(app);
    viewManager = app.get(ViewManagerService);

    // Clean up
    await prisma.objectInstance.deleteMany({ where: { tenantId, objectType: TEST_TYPE } });
    const existing = await prisma.objectType.findFirst({ where: { tenantId, name: TEST_TYPE } });
    if (existing) await prisma.objectType.delete({ where: { id: existing.id } });
    await viewManager.drop(tenantId, TEST_TYPE).catch(() => {});
  });

  afterAll(async () => {
    await prisma.objectInstance.deleteMany({ where: { tenantId, objectType: TEST_TYPE } });
    const existing = await prisma.objectType.findFirst({ where: { tenantId, name: TEST_TYPE } });
    if (existing) await prisma.objectType.delete({ where: { id: existing.id } });
    await viewManager.drop(tenantId, TEST_TYPE).catch(() => {});
    await cleanupTestTenant(app);
    await prisma.$disconnect();
    await app.close();
  });

  it('creates materialized view when objectType is created', async () => {
    await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: TEST_TYPE,
        label: 'MV Test Product',
        properties: [
          { name: 'title', type: 'string', label: 'Title', filterable: true, sortable: true },
          { name: 'price', type: 'number', label: 'Price', filterable: true, sortable: true },
          { name: 'category', type: 'string', label: 'Category', filterable: true },
        ],
      })
      .expect(201);

    const exists = await viewManager.exists(tenantId, TEST_TYPE);
    expect(exists).toBe(true);
  });

  it('QueryPlanner uses view when available — query returns correct results', async () => {
    // Seed instances
    await prisma.objectInstance.createMany({
      data: [
        { tenantId, objectType: TEST_TYPE, externalId: 'MV-001', properties: { title: 'Widget A', price: 100, category: 'electronics' }, relationships: {} },
        { tenantId, objectType: TEST_TYPE, externalId: 'MV-002', properties: { title: 'Widget B', price: 200, category: 'electronics' }, relationships: {} },
        { tenantId, objectType: TEST_TYPE, externalId: 'MV-003', properties: { title: 'Gadget C', price: 50, category: 'toys' }, relationships: {} },
      ],
    });

    // Refresh view to include new instances
    await viewManager.refresh(tenantId, TEST_TYPE);

    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: TEST_TYPE,
        filters: [{ field: 'category', operator: 'eq', value: 'electronics' }],
        sort: { field: 'price', direction: 'desc' },
      })
      .expect(201);

    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].properties.price).toBe(200);
    expect(res.body.data[1].properties.price).toBe(100);
  });

  it('rebuilds view when objectType schema changes', async () => {
    const type = await prisma.objectType.findFirst({ where: { tenantId, name: TEST_TYPE } });

    await request(app.getHttpServer())
      .put(`/ontology/types/${type!.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        label: 'MV Test Product (Updated)',
        properties: [
          { name: 'title', type: 'string', label: 'Title', filterable: true, sortable: true },
          { name: 'price', type: 'number', label: 'Price', filterable: true, sortable: true },
          { name: 'category', type: 'string', label: 'Category', filterable: true },
          { name: 'inStock', type: 'boolean', label: 'In Stock', filterable: true },
        ],
      })
      .expect(200);

    // View should still exist after schema change
    const exists = await viewManager.exists(tenantId, TEST_TYPE);
    expect(exists).toBe(true);
  });

  it('drops view when objectType is deleted', async () => {
    const type = await prisma.objectType.findFirst({ where: { tenantId, name: TEST_TYPE } });

    await request(app.getHttpServer())
      .delete(`/ontology/types/${type!.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const exists = await viewManager.exists(tenantId, TEST_TYPE);
    expect(exists).toBe(false);
  });
});
