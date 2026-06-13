import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@omaha/db';
import { createTestApp, ensureTestTenant, cleanupTestTenant, loginAsTestTenantAdmin } from './test-helpers';
import { ViewManagerService } from '../src/modules/ontology/view-manager.service';

describe('Derived Property v3 — isFullyPaid (e2e)', () => {
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

    const paymentOt = await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'agg_probe_payment',
        label: 'Agg Probe Payment',
        properties: [
          { name: 'amount', label: 'Amount', type: 'number' },
        ],
      })
      .expect(201);
    paymentTypeId = paymentOt.body.id;

    const orderOt = await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'agg_probe_order',
        label: 'Agg Probe Order',
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
            name: 'isFullyPaid',
            label: 'Is Fully Paid',
            type: 'boolean',
            expression: 'sum payments.amount >= totalAmount',
          },
          {
            name: 'paymentCount',
            label: 'Payment Count',
            type: 'number',
            expression: 'count payments >= 1',
          },
        ],
      })
      .expect(200);

    const fullId = await seedOrder('AGG-O-FULL', 100);
    const partialId = await seedOrder('AGG-O-PART', 100);
    const overpaidId = await seedOrder('AGG-O-OVER', 100);
    const noPayId = await seedOrder('AGG-O-NONE', 100);

    await seedPayment('AGG-P-F1', fullId, 100);
    await seedPayment('AGG-P-P1', partialId, 50);
    await seedPayment('AGG-P-O1', overpaidId, 60);
    await seedPayment('AGG-P-O2', overpaidId, 60);

    // Refresh views so seeded rows are visible to QueryPlanner (#54 / #62)
    await viewManager.refresh(tenantId, 'agg_probe_order');
    await viewManager.refresh(tenantId, 'agg_probe_payment');
  });

  async function seedOrder(ext: string, totalAmount: number): Promise<string> {
    const row = await prisma.objectInstance.create({
      data: {
        tenantId,
        objectType: 'agg_probe_order',
        externalId: ext,
        label: ext,
        properties: { totalAmount },
        relationships: {},
      },
    });
    seededIds.push(row.id);
    return ext;
  }

  async function seedPayment(ext: string, orderExternalId: string, amount: number): Promise<void> {
    const row = await prisma.objectInstance.create({
      data: {
        tenantId,
        objectType: 'agg_probe_payment',
        externalId: ext,
        label: ext,
        properties: { amount },
        relationships: { payments: orderExternalId },
      },
    });
    seededIds.push(row.id);
  }

  afterAll(async () => {
    await cleanupTestTenant(app);
    await prisma.$disconnect();
    await app.close();
  });

  it('isFullyPaid = true returns full and overpaid orders', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'agg_probe_order',
        filters: [{ derivedProperty: 'isFullyPaid', operator: 'eq', value: true }],
      })
      .expect(201);

    const ids = res.body.data.map((r: { externalId: string }) => r.externalId).sort();
    expect(ids).toEqual(['AGG-O-FULL', 'AGG-O-OVER']);
  });

  it('isFullyPaid = false returns partial and unpaid orders (sum coalesces missing to 0)', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'agg_probe_order',
        filters: [{ derivedProperty: 'isFullyPaid', operator: 'eq', value: false }],
      })
      .expect(201);

    const ids = res.body.data.map((r: { externalId: string }) => r.externalId).sort();
    expect(ids).toEqual(['AGG-O-NONE', 'AGG-O-PART']);
  });

  it('count payments distinguishes orders with and without payments', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'agg_probe_order',
        filters: [{ derivedProperty: 'paymentCount', operator: 'eq', value: false }],
      })
      .expect(201);

    const ids = res.body.data.map((r: { externalId: string }) => r.externalId).sort();
    expect(ids).toEqual(['AGG-O-NONE']);
  });
});
