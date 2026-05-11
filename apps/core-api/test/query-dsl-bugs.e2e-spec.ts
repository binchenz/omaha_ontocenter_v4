/**
 * Regression tests for query DSL bugs surfaced by the drama-co Agent acceptance run.
 * - #33: ORDER BY numeric DESC must use ::numeric cast and NULLS LAST.
 * - #34: { operator: 'eq' | 'neq', value: null } must compile to IS NULL / IS NOT NULL.
 * - #35: { operator: 'contains', value: 'X' } must compile to ILIKE %X%.
 *
 * Test strategy: insert a small set of `order` instances with mixed numeric/null
 * totalAmount and various status strings into the demo tenant, then exercise
 * each of the three filter / sort shapes via /query/objects HTTP and assert
 * the order/membership of returned rows.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@omaha/db';
import { createTestApp, loginAsAdmin } from './test-helpers';

describe('Query DSL bugs from drama-co acceptance run (e2e)', () => {
  jest.setTimeout(30_000);
  let app: INestApplication;
  let token: string;
  let prisma: PrismaClient;
  let demoTenantId: string;

  // External ids of the rows we insert here. Cleanup uses these.
  const TEST_EXTERNAL_IDS = ['QDSL-001', 'QDSL-002', 'QDSL-003', 'QDSL-004'];

  beforeAll(async () => {
    app = await createTestApp();
    token = await loginAsAdmin(app);
    prisma = new PrismaClient();
    demoTenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: 'demo' } })).id;

    // Clean any prior test rows
    await prisma.objectInstance.deleteMany({
      where: { tenantId: demoTenantId, externalId: { in: TEST_EXTERNAL_IDS } },
    });

    // Seed: 4 orders with mixed numeric + null totalAmount and varied status text.
    await prisma.objectInstance.createMany({
      data: [
        {
          tenantId: demoTenantId,
          objectType: 'order',
          externalId: 'QDSL-001',
          label: 'qdsl-test-order-1',
          properties: { orderNo: 'QDSL-001', totalAmount: 92, status: 'completed-east-zone' },
          relationships: {},
        },
        {
          tenantId: demoTenantId,
          objectType: 'order',
          externalId: 'QDSL-002',
          label: 'qdsl-test-order-2',
          properties: { orderNo: 'QDSL-002', totalAmount: 9, status: 'pending-west-zone' },
          relationships: {},
        },
        {
          tenantId: demoTenantId,
          objectType: 'order',
          externalId: 'QDSL-003',
          label: 'qdsl-test-order-3',
          // null totalAmount via missing key — properties->>'totalAmount' will be null
          properties: { orderNo: 'QDSL-003', status: 'failed-east-zone' },
          relationships: {},
        },
        {
          tenantId: demoTenantId,
          objectType: 'order',
          externalId: 'QDSL-004',
          label: 'qdsl-test-order-4',
          properties: { orderNo: 'QDSL-004', totalAmount: 50, status: 'COMPLETED' },
          relationships: {},
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.objectInstance.deleteMany({
      where: { tenantId: demoTenantId, externalId: { in: TEST_EXTERNAL_IDS } },
    });
    await prisma.$disconnect();
    await app.close();
  });

  // ============================================================
  // #33: numeric sort with NULLS LAST
  // ============================================================

  it('#33 sorts numeric property numerically (not lexicographically) and places NULL rows last on DESC', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'order',
        filters: [{ field: 'orderNo', operator: 'contains', value: 'QDSL' }],
        sort: { field: 'totalAmount', direction: 'desc' },
        pageSize: 10,
      })
      .expect(201);

    const orderNos = res.body.data.map((d: { properties: { orderNo: string } }) => d.properties.orderNo);
    // Expected: 92 (QDSL-001), 50 (QDSL-004), 9 (QDSL-002), then null (QDSL-003).
    // Without ::numeric cast, '9' > '50' lexicographically, so QDSL-002 would rank above QDSL-004.
    // Without NULLS LAST, QDSL-003 (null) would rank first.
    expect(orderNos[0]).toBe('QDSL-001');
    expect(orderNos[1]).toBe('QDSL-004');
    expect(orderNos[2]).toBe('QDSL-002');
    expect(orderNos[3]).toBe('QDSL-003');
  });

  it('#33 ASC sort also places NULLs last so the agent\'s "top item" intuition holds', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'order',
        filters: [{ field: 'orderNo', operator: 'contains', value: 'QDSL' }],
        sort: { field: 'totalAmount', direction: 'asc' },
        pageSize: 10,
      })
      .expect(201);

    const orderNos = res.body.data.map((d: { properties: { orderNo: string } }) => d.properties.orderNo);
    expect(orderNos[0]).toBe('QDSL-002'); // 9
    expect(orderNos[1]).toBe('QDSL-004'); // 50
    expect(orderNos[2]).toBe('QDSL-001'); // 92
    expect(orderNos[3]).toBe('QDSL-003'); // null
  });

  // ============================================================
  // #34: eq/neq null → IS NULL / IS NOT NULL
  // ============================================================

  it('#34 { operator: "neq", value: null } returns rows where the property is NOT NULL', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'order',
        filters: [
          { field: 'orderNo', operator: 'contains', value: 'QDSL' },
          { field: 'totalAmount', operator: 'neq', value: null },
        ],
        pageSize: 10,
      })
      .expect(201);

    const orderNos = res.body.data.map((d: { properties: { orderNo: string } }) => d.properties.orderNo);
    expect(orderNos.sort()).toEqual(['QDSL-001', 'QDSL-002', 'QDSL-004']);
  });

  it('#34 { operator: "eq", value: null } returns only rows where the property IS NULL', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'order',
        filters: [
          { field: 'orderNo', operator: 'contains', value: 'QDSL' },
          { field: 'totalAmount', operator: 'eq', value: null },
        ],
        pageSize: 10,
      })
      .expect(201);

    const orderNos = res.body.data.map((d: { properties: { orderNo: string } }) => d.properties.orderNo);
    expect(orderNos).toEqual(['QDSL-003']);
  });

  // ============================================================
  // #35: contains → ILIKE %X% (case-insensitive substring)
  // ============================================================

  it('#35 { operator: "contains", value: "X" } matches substrings, not exact equality', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'order',
        filters: [{ field: 'status', operator: 'contains', value: 'east' }],
        pageSize: 10,
      })
      .expect(201);

    const orderNos = res.body.data.map((d: { properties: { orderNo: string } }) => d.properties.orderNo);
    // Both QDSL-001 ('completed-east-zone') and QDSL-003 ('failed-east-zone') contain 'east'.
    expect(orderNos.sort()).toEqual(['QDSL-001', 'QDSL-003']);
  });

  it('#35 contains is case-insensitive (ILIKE-equivalent)', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'order',
        filters: [{ field: 'status', operator: 'contains', value: 'COMPLETED' }],
        pageSize: 10,
      })
      .expect(201);

    const orderNos = res.body.data.map((d: { properties: { orderNo: string } }) => d.properties.orderNo).sort();
    // QDSL-001 has 'completed-east-zone' (lowercase), QDSL-004 has 'COMPLETED' (uppercase).
    // contains 'COMPLETED' should match both.
    expect(orderNos).toEqual(['QDSL-001', 'QDSL-004']);
  });

  it('#35 contains returns 0 rows when no row\'s value contains the query string', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'order',
        filters: [{ field: 'status', operator: 'contains', value: 'absolutely-not-in-any-status' }],
        pageSize: 10,
      })
      .expect(201);
    expect(res.body.data).toEqual([]);
  });
});
