/**
 * Scenario 3: Ontology evolution + relationship lifecycle
 *
 * Story: A CRM admin builds up a schema incrementally: Customer → Order
 * relationship, adds a derived property (customer.totalRevenue), seeds data,
 * queries with include, evolves the schema (adds Product + LineItem types,
 * new relationships, more derived properties), then deletes a relationship
 * and verifies indexes/views reconcile correctly.
 *
 * Exercises: relationship lifecycle, derived property validation + cycle
 * detection, include-select, materialized view rebuild on schema change,
 * IndexManager reconcile across multiple schema mutations.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@omaha/db';
import { createTestApp, loginAsAdmin } from './test-helpers';
import { ViewManagerService } from '../src/modules/ontology/view-manager.service';

describe('Scenario: Ontology evolution + relationship lifecycle (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let prisma: PrismaClient;
  let tenantId: string;
  let viewManager: ViewManagerService;

  let customerTypeId: string;
  let orderTypeId: string;
  let productTypeId: string;

  const seededInstanceIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    token = await loginAsAdmin(app);
    prisma = new PrismaClient();

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    tenantId = me.body.tenantId;
    viewManager = app.get(ViewManagerService);

    // Clean up from previous runs
    for (const name of ['evo_customer', 'evo_order', 'evo_product']) {
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
  });

  afterAll(async () => {
    for (const id of seededInstanceIds) {
      await prisma.$executeRawUnsafe(`DELETE FROM object_instances WHERE id = $1::uuid`, id);
    }
    for (const id of [orderTypeId, productTypeId, customerTypeId]) {
      if (!id) continue;
      const t = await prisma.objectType.findUnique({ where: { id } });
      if (t) {
        await prisma.objectRelationship.deleteMany({
          where: { tenantId, OR: [{ sourceTypeId: id }, { targetTypeId: id }] },
        });
        await prisma.objectType.delete({ where: { id } });
        await viewManager.drop(tenantId, t.name).catch(() => {});
      }
    }
    await prisma.$disconnect();
    await app.close();
  });

  it('step 1: create Customer objectType', async () => {
    const res = await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'evo_customer',
        label: 'Customer',
        properties: [
          { name: 'name', type: 'string', label: 'Name', filterable: true, sortable: true },
          { name: 'tier', type: 'string', label: 'Tier', filterable: true },
        ],
      })
      .expect(201);
    customerTypeId = res.body.id;
    expect(await viewManager.exists(tenantId, 'evo_customer')).toBe(true);
  });

  it('step 2: create Order objectType and Customer→Order relationship', async () => {
    const orderRes = await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'evo_order',
        label: 'Order',
        properties: [
          { name: 'orderNo', type: 'string', label: 'No', filterable: true },
          { name: 'totalAmount', type: 'number', label: 'Total', filterable: true, sortable: true },
        ],
      })
      .expect(201);
    orderTypeId = orderRes.body.id;

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

    // Verify the relationship appears in the listing
    const rels = await request(app.getHttpServer())
      .get('/ontology/relationships')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const orderRel = rels.body.find((r: any) => r.name === 'orders' && r.sourceType.name === 'evo_customer');
    expect(orderRel).toBeDefined();
    expect(orderRel.targetType.name).toBe('evo_order');
  });

  it('step 3: seed 2 customers and 5 orders, query with include', async () => {
    const alpha = await prisma.objectInstance.create({
      data: {
        tenantId, objectType: 'evo_customer',
        externalId: 'EVO-C-ALPHA', label: 'Alpha Corp',
        properties: { name: 'Alpha Corp', tier: 'gold' }, relationships: {},
      },
    });
    const beta = await prisma.objectInstance.create({
      data: {
        tenantId, objectType: 'evo_customer',
        externalId: 'EVO-C-BETA', label: 'Beta LLC',
        properties: { name: 'Beta LLC', tier: 'silver' }, relationships: {},
      },
    });
    seededInstanceIds.push(alpha.id, beta.id);

    const orderData = [
      { externalId: 'EVO-O-1', customerId: alpha.id, orderNo: 'A-001', totalAmount: 10000 },
      { externalId: 'EVO-O-2', customerId: alpha.id, orderNo: 'A-002', totalAmount: 25000 },
      { externalId: 'EVO-O-3', customerId: alpha.id, orderNo: 'A-003', totalAmount: 15000 },
      { externalId: 'EVO-O-4', customerId: beta.id, orderNo: 'B-001', totalAmount: 5000 },
      { externalId: 'EVO-O-5', customerId: beta.id, orderNo: 'B-002', totalAmount: 8000 },
    ];
    for (const od of orderData) {
      const row = await prisma.objectInstance.create({
        data: {
          tenantId, objectType: 'evo_order',
          externalId: od.externalId, label: od.orderNo,
          properties: { orderNo: od.orderNo, totalAmount: od.totalAmount },
          relationships: { evo_customerId: od.customerId },
        },
      });
      seededInstanceIds.push(row.id);
    }

    await viewManager.refresh(tenantId, 'evo_customer');
    await viewManager.refresh(tenantId, 'evo_order');

    // Query Alpha customer with included orders
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'evo_customer',
        filters: [{ field: 'name', operator: 'eq', value: 'Alpha Corp' }],
        include: ['orders'],
      })
      .expect(201);

    expect(res.body.data).toHaveLength(1);
    const alphaRow = res.body.data[0];
    expect(alphaRow.relationships.orders).toBeDefined();
    expect(alphaRow.relationships.orders).toHaveLength(3);
    const orderNos = alphaRow.relationships.orders.map((o: any) => o.properties.orderNo).sort();
    expect(orderNos).toEqual(['A-001', 'A-002', 'A-003']);
  });

  it('step 4: reject derived property with cycle (a → b → a)', async () => {
    const res = await request(app.getHttpServer())
      .put(`/ontology/types/${customerTypeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        label: 'Customer',
        properties: [
          { name: 'name', type: 'string', label: 'Name', filterable: true, sortable: true },
          { name: 'tier', type: 'string', label: 'Tier', filterable: true },
        ],
        derivedProperties: [
          { name: 'a', label: 'A', type: 'number', expression: 'b + 1' },
          { name: 'b', label: 'B', type: 'number', expression: 'a + 1' },
        ],
      });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/cycle/i);
  });

  it('step 5: reject derived property with unknown identifier', async () => {
    const res = await request(app.getHttpServer())
      .put(`/ontology/types/${customerTypeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        label: 'Customer',
        properties: [{ name: 'name', type: 'string', label: 'Name', filterable: true }],
        derivedProperties: [
          { name: 'nonsense', label: 'X', type: 'number', expression: 'fieldDoesNotExist + 1' },
        ],
      });
    expect(res.status).toBe(400);
  });

  it('step 6: add derived property customer.totalRevenue = sum orders.totalAmount', async () => {
    const res = await request(app.getHttpServer())
      .put(`/ontology/types/${customerTypeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        label: 'Customer',
        properties: [
          { name: 'name', type: 'string', label: 'Name', filterable: true, sortable: true },
          { name: 'tier', type: 'string', label: 'Tier', filterable: true },
        ],
        derivedProperties: [
          { name: 'totalRevenue', label: 'Total Revenue', type: 'number', expression: 'sum orders.totalAmount' },
        ],
      })
      .expect(200);

    expect(res.body.derivedProperties).toHaveLength(1);
    expect(res.body.derivedProperties[0].name).toBe('totalRevenue');

    // Filter by the derived property: Alpha has 3 orders totalling 50000 → matches >= 20000
    // Beta has 2 orders totalling 13000 → does not match
    const filtered = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'evo_customer',
        filters: [{ derivedProperty: 'totalRevenue', operator: 'gte', value: 20000 }],
      })
      .expect(201);

    const names = filtered.body.data.map((d: any) => d.properties.name);
    expect(names).toContain('Alpha Corp');
    expect(names).not.toContain('Beta LLC');
  });

  it('step 7: extend schema — add Product type', async () => {
    const productRes = await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'evo_product',
        label: 'Product',
        properties: [
          { name: 'sku', type: 'string', label: 'SKU', filterable: true },
          { name: 'price', type: 'number', label: 'Price', filterable: true, sortable: true },
        ],
      })
      .expect(201);
    productTypeId = productRes.body.id;

    expect(await viewManager.exists(tenantId, 'evo_product')).toBe(true);
  });

  it('step 8: seed products + query with filter + sort', async () => {
    await prisma.objectInstance.createMany({
      data: [
        { tenantId, objectType: 'evo_product', externalId: 'EVO-P-1', properties: { sku: 'WIDGET-001', price: 100 }, relationships: {} },
        { tenantId, objectType: 'evo_product', externalId: 'EVO-P-2', properties: { sku: 'GADGET-001', price: 250 }, relationships: {} },
        { tenantId, objectType: 'evo_product', externalId: 'EVO-P-3', properties: { sku: 'WIDGET-002', price: 75 }, relationships: {} },
      ],
    });
    await viewManager.refresh(tenantId, 'evo_product');

    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'evo_product',
        filters: [{ field: 'price', operator: 'gte', value: 100 }],
        sort: { field: 'price', direction: 'desc' },
      })
      .expect(201);

    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].properties.sku).toBe('GADGET-001');
    expect(res.body.data[1].properties.sku).toBe('WIDGET-001');
  });

  it('step 9: delete Customer→Order relationship; listing confirms it is gone', async () => {
    const rels = await prisma.objectRelationship.findMany({ where: { tenantId } });
    const orderRel = rels.find(r => r.name === 'orders' && r.sourceTypeId === customerTypeId);
    expect(orderRel).toBeDefined();

    await request(app.getHttpServer())
      .delete(`/ontology/relationships/${orderRel!.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const after = await request(app.getHttpServer())
      .get('/ontology/relationships')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const stillPresent = after.body.find(
      (r: any) => r.name === 'orders' && r.sourceType.name === 'evo_customer',
    );
    expect(stillPresent).toBeUndefined();
  });

  it('step 10: add a new filterable field — view + index reconcile', async () => {
    await request(app.getHttpServer())
      .put(`/ontology/types/${customerTypeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        label: 'Customer',
        properties: [
          { name: 'name', type: 'string', label: 'Name', filterable: true, sortable: true },
          { name: 'tier', type: 'string', label: 'Tier', filterable: true },
          { name: 'industry', type: 'string', label: 'Industry', filterable: true },
        ],
        // Drop totalRevenue derived property — the orders relationship was deleted in step 9
        derivedProperties: [],
      })
      .expect(200);

    expect(await viewManager.exists(tenantId, 'evo_customer')).toBe(true);

    // Filtering by the new field must not crash, even with no data yet
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'evo_customer',
        filters: [{ field: 'industry', operator: 'eq', value: 'tech' }],
      })
      .expect(201);
    expect(res.body.data).toHaveLength(0);
  });

  it('step 11: deleting Order type — view dropped, relationships cleaned up', async () => {
    await request(app.getHttpServer())
      .delete(`/ontology/types/${orderTypeId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(await viewManager.exists(tenantId, 'evo_order')).toBe(false);

    const rels = await prisma.objectRelationship.findMany({ where: { tenantId } });
    const dangling = rels.filter(r =>
      r.sourceTypeId === orderTypeId || r.targetTypeId === orderTypeId,
    );
    expect(dangling).toHaveLength(0);

    orderTypeId = '';
  });

  it('step 12: Customer type remains healthy after all schema mutations', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'evo_customer',
        filters: [{ field: 'tier', operator: 'eq', value: 'gold' }],
      })
      .expect(201);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].properties.name).toBe('Alpha Corp');
  });
});
