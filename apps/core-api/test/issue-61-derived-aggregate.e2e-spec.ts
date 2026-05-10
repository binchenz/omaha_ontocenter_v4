/**
 * Regression test for #61 — derived property with sum(rel.field) on updateObjectType.
 *
 * The DSL syntax is `sum <rel>.<field>` (no parens), not `sum(<rel>.<field>)`.
 * This test uses the correct syntax and verifies the full path:
 *   create source type → create relationship → update source type
 *   with a derived property that references a relation aggregate.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@omaha/db';
import { createTestApp, loginAsAdmin } from './test-helpers';
import { ViewManagerService } from '../src/modules/ontology/view-manager.service';

describe('Regression #61: derived property with relation aggregate on update', () => {
  let app: INestApplication;
  let token: string;
  let prisma: PrismaClient;
  let tenantId: string;
  let viewManager: ViewManagerService;
  let customerTypeId: string;
  let orderTypeId: string;

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

    // Clean slate
    for (const name of ['bug61_customer', 'bug61_order']) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM object_instances WHERE tenant_id = $1::uuid AND object_type = $2`,
        tenantId, name,
      );
      const t = await prisma.objectType.findFirst({ where: { tenantId, name } });
      if (t) {
        await prisma.objectRelationship.deleteMany({
          where: { tenantId, OR: [{ sourceTypeId: t.id }, { targetTypeId: t.id }] },
        });
        await prisma.objectType.delete({ where: { id: t.id } });
      }
      await viewManager.drop(tenantId, name).catch(() => {});
    }

    // Create customer + order + relation
    customerTypeId = (await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'bug61_customer',
        label: 'Customer',
        properties: [{ name: 'name', type: 'string', label: 'Name', filterable: true }],
      })
      .expect(201)).body.id;

    orderTypeId = (await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'bug61_order',
        label: 'Order',
        properties: [{ name: 'totalAmount', type: 'number', label: 'Total', filterable: true, sortable: true }],
      })
      .expect(201)).body.id;

    await request(app.getHttpServer())
      .post('/ontology/relationships')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sourceTypeId: customerTypeId,
        targetTypeId: orderTypeId,
        name: 'orders',
        cardinality: 'one-to-many',
      })
      .expect(201);
  });

  afterAll(async () => {
    for (const name of ['bug61_customer', 'bug61_order']) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM object_instances WHERE tenant_id = $1::uuid AND object_type = $2`,
        tenantId, name,
      );
      const t = await prisma.objectType.findFirst({ where: { tenantId, name } });
      if (t) {
        await prisma.objectRelationship.deleteMany({
          where: { tenantId, OR: [{ sourceTypeId: t.id }, { targetTypeId: t.id }] },
        });
        await prisma.objectType.delete({ where: { id: t.id } });
      }
      await viewManager.drop(tenantId, name).catch(() => {});
    }
    await prisma.$disconnect();
    await app.close();
  });

  it('update Customer with derivedProperty sum orders.totalAmount succeeds (correct DSL syntax, no parens)', async () => {
    const res = await request(app.getHttpServer())
      .put(`/ontology/types/${customerTypeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        label: 'Customer',
        properties: [{ name: 'name', type: 'string', label: 'Name', filterable: true }],
        derivedProperties: [
          {
            name: 'totalRevenue',
            label: 'Total Revenue',
            type: 'number',
            expression: 'sum orders.totalAmount',
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.derivedProperties).toHaveLength(1);
    expect(res.body.derivedProperties[0].name).toBe('totalRevenue');
  });
});
