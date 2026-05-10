import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@omaha/db';
import { createTestApp, loginAsAdmin } from './test-helpers';

describe('QueryPlanner + QueryService (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let prisma: PrismaClient;
  let demoTenantId: string;

  const CUST_IDS = ['QPT-C01', 'QPT-C02', 'QPT-C03', 'QPT-C04', 'QPT-C05'];
  const ORD_IDS = ['QPT-O01', 'QPT-O02', 'QPT-O03'];

  beforeAll(async () => {
    app = await createTestApp();
    token = await loginAsAdmin(app);
    prisma = new PrismaClient();
    demoTenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: 'demo' } })).id;

    // Clean up
    await prisma.objectInstance.deleteMany({
      where: { tenantId: demoTenantId, externalId: { in: [...CUST_IDS, ...ORD_IDS] } },
    });

    // Seed customers (filterable: name, contact, region, level)
    await prisma.objectInstance.createMany({
      data: [
        { tenantId: demoTenantId, objectType: 'customer', externalId: 'QPT-C01', label: 'QPT Alpha', properties: { name: 'QPT-Alpha', region: '华东', contact: 'Alice', level: 'A' }, relationships: {}, searchText: 'QPT-Alpha 华东 Alice' },
        { tenantId: demoTenantId, objectType: 'customer', externalId: 'QPT-C02', label: 'QPT Beta', properties: { name: 'QPT-Beta', region: '华北', contact: 'Bob', level: 'B' }, relationships: {}, searchText: 'QPT-Beta 华北 Bob' },
        { tenantId: demoTenantId, objectType: 'customer', externalId: 'QPT-C03', label: 'QPT Gamma', properties: { name: 'QPT-Gamma', region: '华东', contact: 'Carol', level: 'A' }, relationships: {}, searchText: 'QPT-Gamma 华东 Carol' },
        { tenantId: demoTenantId, objectType: 'customer', externalId: 'QPT-C04', label: 'QPT Delta', properties: { name: 'QPT-Delta', region: '华南', contact: 'Dave', level: 'C' }, relationships: {}, searchText: 'QPT-Delta 华南 Dave' },
        { tenantId: demoTenantId, objectType: 'customer', externalId: 'QPT-C05', label: 'QPT Epsilon', properties: { name: 'QPT-Epsilon', region: '华东', contact: null, level: 'B' }, relationships: {}, searchText: 'QPT-Epsilon 华东' },
      ],
    });

    // Seed orders (filterable: orderNo, orderDate, totalAmount, status)
    await prisma.objectInstance.createMany({
      data: [
        { tenantId: demoTenantId, objectType: 'order', externalId: 'QPT-O01', label: 'QPT Order 1', properties: { orderNo: 'QPT-O01', totalAmount: 75000, status: 'completed', orderDate: '2024-01-15' }, relationships: {} },
        { tenantId: demoTenantId, objectType: 'order', externalId: 'QPT-O02', label: 'QPT Order 2', properties: { orderNo: 'QPT-O02', totalAmount: 25000, status: 'pending', orderDate: '2024-02-20' }, relationships: {} },
        { tenantId: demoTenantId, objectType: 'order', externalId: 'QPT-O03', label: 'QPT Order 3', properties: { orderNo: 'QPT-O03', totalAmount: 50000, status: 'completed', orderDate: '2024-03-10' }, relationships: {} },
      ],
    });
  });

  afterAll(async () => {
    await prisma.objectInstance.deleteMany({
      where: { tenantId: demoTenantId, externalId: { in: [...CUST_IDS, ...ORD_IDS] } },
    });
    await prisma.$disconnect();
    await app.close();
  });

  describe('basic filters', () => {
    it('eq filter on string property returns matching rows', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/objects')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'customer',
          filters: [
            { field: 'name', operator: 'contains', value: 'QPT-' },
            { field: 'region', operator: 'eq', value: '华东' },
          ],
        })
        .expect(201);

      const ids = res.body.data.map((d: any) => d.externalId);
      expect(ids).toContain('QPT-C01');
      expect(ids).toContain('QPT-C03');
      expect(ids).toContain('QPT-C05');
      expect(ids).not.toContain('QPT-C02');
    });

    it('neq filter excludes matching rows', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/objects')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'customer',
          filters: [
            { field: 'name', operator: 'contains', value: 'QPT-' },
            { field: 'region', operator: 'neq', value: '华东' },
          ],
        })
        .expect(201);

      const ids = res.body.data.map((d: any) => d.externalId);
      expect(ids).toContain('QPT-C02');
      expect(ids).toContain('QPT-C04');
      expect(ids).not.toContain('QPT-C01');
    });

    it('contains filter does case-insensitive substring match', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/objects')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'customer',
          filters: [{ field: 'name', operator: 'contains', value: 'qpt-alpha' }],
        })
        .expect(201);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].externalId).toBe('QPT-C01');
    });
  });

  describe('numeric filters with sort', () => {
    it('gte filter on numeric property', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/objects')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'order',
          filters: [
            { field: 'orderNo', operator: 'contains', value: 'QPT-O' },
            { field: 'totalAmount', operator: 'gte', value: 50000 },
          ],
        })
        .expect(201);

      const ids = res.body.data.map((d: any) => d.externalId);
      expect(ids).toContain('QPT-O01');
      expect(ids).toContain('QPT-O03');
      expect(ids).not.toContain('QPT-O02');
    });

    it('sort by numeric property descending', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/objects')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'order',
          filters: [{ field: 'orderNo', operator: 'contains', value: 'QPT-O' }],
          sort: { field: 'totalAmount', direction: 'desc' },
        })
        .expect(201);

      const amounts = res.body.data.map((d: any) => d.properties.totalAmount);
      expect(amounts).toEqual([75000, 50000, 25000]);
    });
  });

  describe('combined AND filters', () => {
    it('multiple filters combine with AND', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/objects')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'order',
          filters: [
            { field: 'orderNo', operator: 'contains', value: 'QPT-O' },
            { field: 'status', operator: 'eq', value: 'completed' },
            { field: 'totalAmount', operator: 'gte', value: 50000 },
          ],
        })
        .expect(201);

      const ids = res.body.data.map((d: any) => d.externalId);
      expect(ids).toContain('QPT-O01');
      expect(ids).toContain('QPT-O03');
      expect(ids).not.toContain('QPT-O02');
    });
  });

  describe('search (ILIKE)', () => {
    it('search matches against searchText', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/objects')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'customer',
          search: 'QPT-Alpha',
        })
        .expect(201);

      const ids = res.body.data.map((d: any) => d.externalId);
      expect(ids).toContain('QPT-C01');
      expect(ids).not.toContain('QPT-C02');
    });
  });

  describe('pagination', () => {
    it('respects page and pageSize', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/objects')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'customer',
          filters: [{ field: 'name', operator: 'contains', value: 'QPT-' }],
          page: 1,
          pageSize: 2,
          sort: { field: 'region', direction: 'asc' },
        })
        .expect(201);

      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta.total).toBe(5);
      expect(res.body.meta.page).toBe(1);
      expect(res.body.meta.pageSize).toBe(2);
      expect(res.body.meta.totalPages).toBe(3);
    });

    it('page 2 returns different rows than page 1', async () => {
      const page1 = await request(app.getHttpServer())
        .post('/query/objects')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'customer',
          filters: [{ field: 'name', operator: 'contains', value: 'QPT-' }],
          page: 1,
          pageSize: 2,
          sort: { field: 'region', direction: 'asc' },
        })
        .expect(201);

      const page2 = await request(app.getHttpServer())
        .post('/query/objects')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'customer',
          filters: [{ field: 'name', operator: 'contains', value: 'QPT-' }],
          page: 2,
          pageSize: 2,
          sort: { field: 'region', direction: 'asc' },
        })
        .expect(201);

      const ids1 = new Set(page1.body.data.map((d: any) => d.externalId));
      const ids2 = page2.body.data.map((d: any) => d.externalId);
      for (const id of ids2) {
        expect(ids1.has(id)).toBe(false);
      }
    });
  });

  describe('error cases', () => {
    it('rejects filter on non-filterable property', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/objects')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'customer',
          filters: [{ field: 'phone', operator: 'eq', value: '123' }],
        })
        .expect(400);

      expect(JSON.stringify(res.body)).toMatch(/PROPERTY_NOT_FILTERABLE|filterable/i);
    });

    it('sort on non-sortable property falls back with reason', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/objects')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'customer',
          filters: [{ field: 'name', operator: 'contains', value: 'QPT-' }],
          sort: { field: 'name', direction: 'asc' },
        })
        .expect(201);

      expect(res.body.meta.sortFallbackReason).toBeTruthy();
      expect(res.body.meta.sortFallbackReason).toMatch(/not.*sortable/i);
    });
  });

  describe('null handling', () => {
    it('eq null filter uses IS NULL', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/objects')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'customer',
          filters: [
            { field: 'name', operator: 'contains', value: 'QPT-' },
            { field: 'contact', operator: 'eq', value: null },
          ],
        })
        .expect(201);

      const ids = res.body.data.map((d: any) => d.externalId);
      expect(ids).toContain('QPT-C05');
      expect(ids).toHaveLength(1);
    });

    it('neq null filter uses IS NOT NULL', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/objects')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'customer',
          filters: [
            { field: 'name', operator: 'contains', value: 'QPT-' },
            { field: 'contact', operator: 'neq', value: null },
          ],
        })
        .expect(201);

      const ids = res.body.data.map((d: any) => d.externalId);
      expect(ids).not.toContain('QPT-C05');
      expect(ids).toHaveLength(4);
    });
  });
});
