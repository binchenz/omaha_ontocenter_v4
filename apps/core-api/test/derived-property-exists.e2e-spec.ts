import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@omaha/db';
import { createTestApp, loginAsAdmin } from './test-helpers';
import { ViewManagerService } from '../src/modules/ontology/view-manager.service';

describe('Derived Property v2 — isPaidAt (e2e)', () => {
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
    token = await loginAsAdmin(app);
    prisma = new PrismaClient();
    viewManager = app.get(ViewManagerService);

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    tenantId = me.body.tenantId;

    await prisma.$executeRawUnsafe(
      `DELETE FROM object_instances WHERE tenant_id = $1::uuid AND object_type LIKE 'exists_probe%'`,
      tenantId,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM object_relationships WHERE tenant_id = $1::uuid AND source_type_id IN (SELECT id FROM object_types WHERE tenant_id = $1::uuid AND name LIKE 'exists_probe%')`,
      tenantId,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM object_types WHERE tenant_id = $1::uuid AND name LIKE 'exists_probe%'`,
      tenantId,
    );

    const paymentOt = await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'exists_probe_payment',
        label: 'Exists Probe Payment',
        properties: [
          { name: 'status', label: 'Status', type: 'string' },
          { name: 'paidAt', label: 'PaidAt', type: 'date' },
          { name: 'amount', label: 'Amount', type: 'number' },
        ],
      })
      .expect(201);
    paymentTypeId = paymentOt.body.id;

    const orderOt = await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'exists_probe_order',
        label: 'Exists Probe Order',
        properties: [
          { name: 'totalAmount', label: 'Total', type: 'number' },
        ],
      })
      .expect(201);
    orderTypeId = orderOt.body.id;

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

    await request(app.getHttpServer())
      .put(`/ontology/types/${orderTypeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        derivedProperties: [
          {
            name: 'isPaidAt',
            label: 'Is Paid At',
            type: 'boolean',
            params: [{ name: 'cutoffTime', type: 'datetime' }],
            expression: "exists payments where status = 'Success' and paidAt <= :cutoffTime",
          },
        ],
      })
      .expect(200);

    const orderAId = await seedOrder(tenantId, 'EXISTS-O-A', 100);
    const orderBId = await seedOrder(tenantId, 'EXISTS-O-B', 200);
    const orderCId = await seedOrder(tenantId, 'EXISTS-O-C', 300);

    await seedPayment(tenantId, 'EXISTS-P-A1', orderAId, 'Success', '2026-05-03T08:00:00Z', 100);
    await seedPayment(tenantId, 'EXISTS-P-B1', orderBId, 'Success', '2026-05-04T12:00:00Z', 200);
    await seedPayment(tenantId, 'EXISTS-P-C1', orderCId, 'Failed', '2026-05-03T09:00:00Z', 300);

    // Refresh views so seeded rows are visible to QueryPlanner (#54 / #62)
    await viewManager.refresh(tenantId, 'exists_probe_order');
    await viewManager.refresh(tenantId, 'exists_probe_payment');
  });

  async function seedOrder(tid: string, ext: string, amount: number): Promise<string> {
    const row = await prisma.objectInstance.create({
      data: {
        tenantId: tid,
        objectType: 'exists_probe_order',
        externalId: ext,
        label: ext,
        properties: { totalAmount: amount },
        relationships: {},
      },
    });
    seededIds.push(row.id);
    return row.id;
  }

  async function seedPayment(
    tid: string,
    ext: string,
    orderId: string,
    status: string,
    paidAt: string,
    amount: number,
  ): Promise<void> {
    const row = await prisma.objectInstance.create({
      data: {
        tenantId: tid,
        objectType: 'exists_probe_payment',
        externalId: ext,
        label: ext,
        properties: { status, paidAt, amount },
        relationships: { exists_probe_orderId: orderId },
      },
    });
    seededIds.push(row.id);
  }

  afterAll(async () => {
    for (const id of seededIds) {
      await prisma.$executeRawUnsafe(`DELETE FROM object_instances WHERE id = $1::uuid`, id);
    }
    for (const id of [orderTypeId, paymentTypeId]) {
      if (id) {
        await request(app.getHttpServer())
          .delete(`/ontology/types/${id}`)
          .set('Authorization', `Bearer ${token}`);
      }
    }
    await prisma.$disconnect();
    await app.close();
  });

  it('isPaidAt(cutoffTime=2026-05-04T00:00:00Z) returns only orders paid by that time', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'exists_probe_order',
        filters: [
          {
            derivedProperty: 'isPaidAt',
            operator: 'eq',
            value: true,
            params: { cutoffTime: '2026-05-04T00:00:00Z' },
          },
        ],
      })
      .expect(201);

    const ids = res.body.data.map((r: { externalId: string }) => r.externalId).sort();
    expect(ids).toEqual(['EXISTS-O-A']);
  });

  it('isPaidAt(cutoffTime=2026-05-05T00:00:00Z) catches the later payment too', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'exists_probe_order',
        filters: [
          {
            derivedProperty: 'isPaidAt',
            operator: 'eq',
            value: true,
            params: { cutoffTime: '2026-05-05T00:00:00Z' },
          },
        ],
      })
      .expect(201);

    const ids = res.body.data.map((r: { externalId: string }) => r.externalId).sort();
    expect(ids).toEqual(['EXISTS-O-A', 'EXISTS-O-B']);
  });

  it('isPaidAt treats Failed payments as not paid', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'exists_probe_order',
        filters: [
          {
            derivedProperty: 'isPaidAt',
            operator: 'eq',
            value: false,
            params: { cutoffTime: '2026-05-05T00:00:00Z' },
          },
        ],
      })
      .expect(201);

    const ids = res.body.data.map((r: { externalId: string }) => r.externalId).sort();
    expect(ids).toEqual(['EXISTS-O-C']);
  });

  it('rejects update when an exists references a relation that is not declared on this ObjectType', async () => {
    const ot = await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'exists_probe_bad',
        label: 'Bad',
        properties: [{ name: 'x', label: 'X', type: 'number' }],
      })
      .expect(201);

    try {
      const res = await request(app.getHttpServer())
        .put(`/ontology/types/${ot.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          derivedProperties: [
            {
              name: 'hasGhosts',
              label: 'Has ghosts',
              type: 'boolean',
              expression: 'exists nonexistent_rel where x > 0',
            },
          ],
        })
        .expect(400);
      expect(JSON.stringify(res.body)).toMatch(/nonexistent_rel/);
    } finally {
      await request(app.getHttpServer())
        .delete(`/ontology/types/${ot.body.id}`)
        .set('Authorization', `Bearer ${token}`);
    }
  });
});
