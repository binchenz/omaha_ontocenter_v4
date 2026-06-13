import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@omaha/db';
import { createTestApp, ensureTestTenant, cleanupTestTenant, loginAsTestTenantAdmin } from './test-helpers';
import { ViewManagerService } from '../src/modules/ontology/view-manager.service';

describe('Query include/select (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let prisma: PrismaClient;
  let tenantId: string;
  let orderTypeId: string;
  let paymentTypeId: string;
  let viewManager: ViewManagerService;
  const seededIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    tenantId = await ensureTestTenant(app);
    await cleanupTestTenant(app); // clear any leftovers from a crashed prior run before seeding
    token = await loginAsTestTenantAdmin(app);
    prisma = new PrismaClient();
    viewManager = app.get(ViewManagerService);

    paymentTypeId = (
      await request(app.getHttpServer())
        .post('/ontology/types')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'incl_probe_payment',
          label: 'Incl Payment',
          properties: [
            { name: 'amount', label: 'Amount', type: 'number' },
            { name: 'status', label: 'Status', type: 'string' },
          ],
        })
        .expect(201)
    ).body.id;

    orderTypeId = (
      await request(app.getHttpServer())
        .post('/ontology/types')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'incl_probe_order',
          label: 'Incl Order',
          properties: [{ name: 'totalAmount', label: 'Total', type: 'number', filterable: true }],
        })
        .expect(201)
    ).body.id;

    await request(app.getHttpServer())
      .post('/ontology/relationships')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sourceTypeId: orderTypeId,
        targetTypeId: paymentTypeId,
        name: 'payments',
        cardinality: 'one-to-many',
      })
      .expect(201);

    const orderId = (
      await prisma.objectInstance.create({
        data: {
          tenantId,
          objectType: 'incl_probe_order',
          externalId: 'INC-O-1',
          label: 'INC-O-1',
          properties: { totalAmount: 500 },
          relationships: {},
        },
      })
    ).id;
    seededIds.push(orderId);

    for (const [ext, amount, status] of [
      ['INC-P-1', 100, 'Success'],
      ['INC-P-2', 400, 'Success'],
    ] as const) {
      const row = await prisma.objectInstance.create({
        data: {
          tenantId,
          objectType: 'incl_probe_payment',
          externalId: ext,
          label: ext,
          properties: { amount, status },
          relationships: { payments: 'INC-O-1' },
        },
      });
      seededIds.push(row.id);
    }

    // Refresh views so seeded rows are visible to QueryPlanner (#54 / #62)
    await viewManager.refresh(tenantId, 'incl_probe_order');
    await viewManager.refresh(tenantId, 'incl_probe_payment');
  });

  afterAll(async () => {
    await cleanupTestTenant(app);
    await prisma.$disconnect();
    await app.close();
  });

  it('include: [payments] returns related payments nested under relationships', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'incl_probe_order',
        filters: [{ field: 'totalAmount', operator: 'eq', value: 500 }],
        include: ['payments'],
      })
      .expect(201);

    expect(res.body.data).toHaveLength(1);
    const order = res.body.data[0];
    expect(order.relationships.payments).toBeDefined();
    expect(Array.isArray(order.relationships.payments)).toBe(true);
    const paymentExtIds = order.relationships.payments.map((p: { externalId: string }) => p.externalId).sort();
    expect(paymentExtIds).toEqual(['INC-P-1', 'INC-P-2']);
  });

  it('include: [] returns no relationships data', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'incl_probe_order',
        filters: [{ field: 'totalAmount', operator: 'eq', value: 500 }],
      })
      .expect(201);

    expect(res.body.data[0].relationships.payments).toBeUndefined();
  });

  it('rejects include entry that is not a declared relationship', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'incl_probe_order',
        filters: [{ field: 'totalAmount', operator: 'eq', value: 500 }],
        include: ['ghosts'],
      })
      .expect(400);
    expect(JSON.stringify(res.body)).toMatch(/ghosts/);
  });

  it('select: [totalAmount] drops unlisted properties from response', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'incl_probe_order',
        filters: [{ field: 'totalAmount', operator: 'eq', value: 500 }],
        select: ['totalAmount'],
      })
      .expect(201);

    expect(Object.keys(res.body.data[0].properties)).toEqual(['totalAmount']);
  });
});
