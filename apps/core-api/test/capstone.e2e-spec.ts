import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@omaha/db';
import { createTestApp, loginAsAdmin } from './test-helpers';

describe('Capstone — multi-feature flagship query (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let salesToken: string;
  let adminUserId: string;
  let salesUserId: string;
  let salesRoleId: string;
  let prisma: PrismaClient;
  let tenantId: string;
  let orderTypeId: string;
  let paymentTypeId: string;
  const seededIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    token = await loginAsAdmin(app);
    prisma = new PrismaClient();

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    tenantId = me.body.tenantId;
    adminUserId = me.body.id;

    await prisma.$executeRawUnsafe(
      `DELETE FROM object_instances WHERE tenant_id = $1::uuid AND object_type LIKE 'cap_probe%'`,
      tenantId,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM object_relationships WHERE tenant_id = $1::uuid AND source_type_id IN (SELECT id FROM object_types WHERE tenant_id = $1::uuid AND name LIKE 'cap_probe%')`,
      tenantId,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM object_types WHERE tenant_id = $1::uuid AND name LIKE 'cap_probe%'`,
      tenantId,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM users WHERE email = 'capstone-sales@demo.com'`);
    await prisma.$executeRawUnsafe(`DELETE FROM roles WHERE name = 'capstone-sales'`);

    paymentTypeId = (
      await request(app.getHttpServer())
        .post('/ontology/types')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'cap_probe_payment',
          label: 'Capstone Payment',
          properties: [
            { name: 'amount', label: 'Amount', type: 'number' },
            { name: 'status', label: 'Status', type: 'string' },
            { name: 'paidAt', label: 'PaidAt', type: 'date' },
          ],
        })
        .expect(201)
    ).body.id;

    orderTypeId = (
      await request(app.getHttpServer())
        .post('/ontology/types')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'cap_probe_order',
          label: 'Capstone Order',
          properties: [
            { name: 'city', label: 'City', type: 'string', filterable: true, sortable: true },
            { name: 'createdAt', label: 'Created', type: 'date', filterable: true, sortable: true },
            { name: 'totalAmount', label: 'Total', type: 'number', filterable: true },
            { name: 'salesOwnerId', label: 'Owner', type: 'string', filterable: true },
          ],
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
          {
            name: 'isFullyPaid',
            label: 'Is Fully Paid',
            type: 'boolean',
            expression: 'sum payments.amount >= totalAmount',
          },
        ],
      })
      .expect(200);

    const salesRole = await prisma.role.create({
      data: {
        tenantId,
        name: 'capstone-sales',
        permissions: [
          { permission: 'object.read', condition: 'salesOwnerId = :userId' },
        ] as never,
      },
    });
    salesRoleId = salesRole.id;

    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash('secret123', 10);
    const sales = await prisma.user.create({
      data: {
        tenantId,
        email: 'capstone-sales@demo.com',
        name: 'Capstone Sales',
        passwordHash: hash,
        roleId: salesRoleId,
      },
    });
    salesUserId = sales.id;

    const salesLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'capstone-sales@demo.com', password: 'secret123', tenantSlug: 'demo' });
    salesToken = salesLogin.body.accessToken;

    const orders = [
      { ext: 'CAP-O-1', city: 'Hangzhou', createdAt: '2026-05-03T18:30:00Z', total: 500, owner: salesUserId, payments: [{ amount: 500, status: 'Success', paidAt: '2026-05-04T10:00:00Z' }] },
      { ext: 'CAP-O-2', city: 'Hangzhou', createdAt: '2026-05-03T19:30:00Z', total: 300, owner: salesUserId, payments: [{ amount: 300, status: 'Success', paidAt: '2026-05-04T10:00:00Z' }] },
      { ext: 'CAP-O-3', city: 'Hangzhou', createdAt: '2026-05-03T18:30:00Z', total: 1000, owner: salesUserId, payments: [{ amount: 500, status: 'Success', paidAt: '2026-05-04T10:00:00Z' }] },
      { ext: 'CAP-O-4', city: 'Shanghai', createdAt: '2026-05-03T18:30:00Z', total: 200, owner: salesUserId, payments: [{ amount: 200, status: 'Success', paidAt: '2026-05-04T10:00:00Z' }] },
      { ext: 'CAP-O-5', city: 'Hangzhou', createdAt: '2026-05-03T18:30:00Z', total: 400, owner: adminUserId, payments: [{ amount: 400, status: 'Success', paidAt: '2026-05-04T10:00:00Z' }] },
    ] as const;

    for (const o of orders) {
      const orderId = (
        await prisma.objectInstance.create({
          data: {
            tenantId,
            objectType: 'cap_probe_order',
            externalId: o.ext,
            label: o.ext,
            properties: { city: o.city, createdAt: o.createdAt, totalAmount: o.total, salesOwnerId: o.owner },
            relationships: {},
          },
        })
      ).id;
      seededIds.push(orderId);
      let k = 1;
      for (const p of o.payments) {
        const row = await prisma.objectInstance.create({
          data: {
            tenantId,
            objectType: 'cap_probe_payment',
            externalId: `${o.ext}-P${k++}`,
            label: `${o.ext}-P`,
            properties: { amount: p.amount, status: p.status, paidAt: p.paidAt },
            relationships: { cap_probe_orderId: orderId },
          },
        });
        seededIds.push(row.id);
      }
    }
  });

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
    if (salesUserId) {
      await prisma.$executeRawUnsafe(`DELETE FROM audit_logs WHERE actor_id = $1::uuid`, salesUserId);
      await prisma.$executeRawUnsafe(`DELETE FROM users WHERE id = $1::uuid`, salesUserId);
    }
    if (salesRoleId) {
      await prisma.$executeRawUnsafe(`DELETE FROM roles WHERE id = $1::uuid`, salesRoleId);
    }
    await prisma.$disconnect();
    await app.close();
  });

  it('admin: Hangzhou orders created before 19:00, paid by 11am, fully paid, with include', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'cap_probe_order',
        filters: [
          { field: 'city', operator: 'eq', value: 'Hangzhou' },
          { field: 'createdAt', operator: 'lt', value: '2026-05-03T19:00:00Z' },
          {
            derivedProperty: 'isPaidAt',
            operator: 'eq',
            value: true,
            params: { cutoffTime: '2026-05-04T11:00:00Z' },
          },
          { derivedProperty: 'isFullyPaid', operator: 'eq', value: true },
        ],
        include: ['payments'],
        select: ['city', 'totalAmount'],
        sort: { field: 'createdAt', direction: 'asc' },
      })
      .expect(201);

    const ids = res.body.data.map((r: { externalId: string }) => r.externalId).sort();
    expect(ids).toEqual(['CAP-O-1', 'CAP-O-5']);
    expect(Object.keys(res.body.data[0].properties).sort()).toEqual(['city', 'totalAmount']);
    expect(res.body.data[0].relationships.payments).toBeDefined();
    expect(Array.isArray(res.body.data[0].relationships.payments)).toBe(true);
  });

  it('sales user: same query is automatically scoped by permission DSL', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({
        objectType: 'cap_probe_order',
        filters: [
          { field: 'city', operator: 'eq', value: 'Hangzhou' },
          { field: 'createdAt', operator: 'lt', value: '2026-05-03T19:00:00Z' },
          {
            derivedProperty: 'isPaidAt',
            operator: 'eq',
            value: true,
            params: { cutoffTime: '2026-05-04T11:00:00Z' },
          },
          { derivedProperty: 'isFullyPaid', operator: 'eq', value: true },
        ],
      })
      .expect(201);

    const ids = res.body.data.map((r: { externalId: string }) => r.externalId).sort();
    expect(ids).toEqual(['CAP-O-1']);

    const audits = await prisma.$queryRawUnsafe<{ effective_permission_filter: string }[]>(
      `SELECT effective_permission_filter FROM audit_logs
       WHERE actor_id = $1::uuid AND object_type = 'cap_probe_order'
       ORDER BY created_at DESC LIMIT 1`,
      salesUserId,
    );
    expect(audits[0].effective_permission_filter).toContain(salesUserId);
  });
});
