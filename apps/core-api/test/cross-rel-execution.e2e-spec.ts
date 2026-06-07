import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@omaha/db';
import { createTestApp } from './test-helpers';
import { ViewManagerService } from '../src/modules/ontology/view-manager.service';
import * as bcrypt from 'bcrypt';

/**
 * Cross-relationship aggregation tracer bullet (ADR-0044 §A1).
 *
 * Proves the silent-wrong-data defect: the cross-rel planner JOINs
 *   e.external_id = s.relationships->>'<relationName>'
 * so a child row must store its PARENT's external_id under the relation name.
 * We seed exactly that (the canonical convention), then group delivery legs by
 * a field on their parent order (`order_legs.deliveryMode`) and assert the
 * SUM(duration) per mode matches a raw-SQL ground truth computed independently.
 *
 * Executes real SQL against the dev DB (not a mocked planner) — the only way to
 * catch a join that compiles fine but matches zero rows.
 */
const SLUG = 'tenant_crossrel_exec';
const ADMIN_EMAIL = 'admin@crossrel.local';
const ADMIN_PASSWORD = 'crossrel2026';

const ORDER_TYPE = {
  name: 'cr_order',
  label: '订单',
  properties: [
    { name: 'orderNo', type: 'string', label: '单号', filterable: true },
    { name: 'deliveryMode', type: 'string', label: '配送模式', filterable: true },
  ],
};
const LEG_TYPE = {
  name: 'cr_leg',
  label: '配送段',
  properties: [
    { name: 'legNo', type: 'string', label: '段号', filterable: true },
    { name: 'duration', type: 'number', label: '耗时', filterable: true, sortable: true },
  ],
};

// 2 orders, 4 legs. relay = 10 + 30 = 40; rider_only = 5 + 7 = 12.
const ORDERS = [
  { externalId: 'CRO-1', properties: { orderNo: 'CRO-1', deliveryMode: 'relay' } },
  { externalId: 'CRO-2', properties: { orderNo: 'CRO-2', deliveryMode: 'rider_only' } },
];
const LEGS = [
  { externalId: 'CRO-1-L1', properties: { legNo: 'CRO-1-L1', duration: 10 }, parentExternalId: 'CRO-1' },
  { externalId: 'CRO-1-L2', properties: { legNo: 'CRO-1-L2', duration: 30 }, parentExternalId: 'CRO-1' },
  { externalId: 'CRO-2-L1', properties: { legNo: 'CRO-2-L1', duration: 5 }, parentExternalId: 'CRO-2' },
  { externalId: 'CRO-2-L2', properties: { legNo: 'CRO-2-L2', duration: 7 }, parentExternalId: 'CRO-2' },
];

describe('Cross-relationship aggregation execution (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;
  let tenantId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaClient();

    let tenant = await prisma.tenant.findUnique({ where: { slug: SLUG } });
    if (!tenant) tenant = await prisma.tenant.create({ data: { slug: SLUG, name: '跨关系执行测试' } });
    tenantId = tenant.id;

    const existing = await prisma.user.findFirst({ where: { tenantId, email: ADMIN_EMAIL } });
    if (!existing) {
      let role = await prisma.role.findFirst({ where: { tenantId, name: 'admin' } });
      if (!role) role = await prisma.role.create({ data: { tenantId, name: 'admin', permissions: ['*'] } });
      await prisma.user.create({
        data: { tenantId, email: ADMIN_EMAIL, name: 'Admin', passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10), roleId: role.id },
      });
    }

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, tenantSlug: SLUG });
    token = login.body.accessToken;

    // Clean
    await prisma.objectInstance.deleteMany({ where: { tenantId, objectType: { in: [ORDER_TYPE.name, LEG_TYPE.name] } } });
    await prisma.objectRelationship.deleteMany({ where: { tenantId } });
    await prisma.objectType.deleteMany({ where: { tenantId, name: { in: [ORDER_TYPE.name, LEG_TYPE.name] } } });

    // Types via API
    const typeIds = new Map<string, string>();
    for (const spec of [ORDER_TYPE, LEG_TYPE]) {
      const res = await request(app.getHttpServer())
        .post('/ontology/types').set('Authorization', `Bearer ${token}`).send(spec).expect(201);
      typeIds.set(spec.name, res.body.id);
    }

    // Relationship: order --order_legs--> leg (one-to-many; FK on the leg/many side).
    await request(app.getHttpServer())
      .post('/ontology/relationships').set('Authorization', `Bearer ${token}`)
      .send({ sourceTypeId: typeIds.get(ORDER_TYPE.name), targetTypeId: typeIds.get(LEG_TYPE.name), name: 'order_legs', cardinality: 'one-to-many' })
      .expect(201);

    // Instances. Canonical convention: child stores { <relationName>: <parent externalId> }.
    await prisma.objectInstance.createMany({
      data: ORDERS.map(o => ({ tenantId, objectType: ORDER_TYPE.name, externalId: o.externalId, label: o.externalId, properties: o.properties as any, relationships: {} as any })),
    });
    await prisma.objectInstance.createMany({
      data: LEGS.map(l => ({ tenantId, objectType: LEG_TYPE.name, externalId: l.externalId, label: l.externalId, properties: l.properties as any, relationships: { order_legs: l.parentExternalId } as any })),
    });

    const viewManager = app.get(ViewManagerService);
    await Promise.all([ORDER_TYPE.name, LEG_TYPE.name].map(n => viewManager.refresh(tenantId, n).catch(() => {})));
  }, 120_000);

  afterAll(async () => {
    if (!prisma) return;
    if (tenantId) {
      await prisma.objectInstance.deleteMany({ where: { tenantId, objectType: { in: [ORDER_TYPE.name, LEG_TYPE.name] } } });
      await prisma.objectRelationship.deleteMany({ where: { tenantId } });
      await prisma.objectType.deleteMany({ where: { tenantId, name: { in: [ORDER_TYPE.name, LEG_TYPE.name] } } });
    }
    await prisma.$disconnect();
    if (app) await app.close();
  }, 60_000);

  it('groups legs by parent order field (order_legs.deliveryMode) and sums duration correctly', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/aggregate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: LEG_TYPE.name,
        groupBy: ['order_legs.deliveryMode'],
        metrics: [{ kind: 'sum', field: 'duration', alias: 'total' }],
      })
      .expect(201);

    const byMode = Object.fromEntries(
      res.body.groups.map((g: any) => [g.key['order_legs.deliveryMode'], Number(g.metrics.total)]),
    );
    // Ground truth: relay = 10+30 = 40, rider_only = 5+7 = 12.
    expect(byMode.relay).toBe(40);
    expect(byMode.rider_only).toBe(12);
  });

  // The genuinely-red half: the include path must read the SAME canonical
  // convention (child stores { order_legs: <parent externalId> }). Today it
  // joins relationships->>'cr_orderId' = parent.id (UUID) — a different
  // convention — so it silently returns zero legs. A1 (Slice 1) converges
  // include onto the relation-name/external_id convention; this turns green.
  it('include order_legs returns the child legs under the canonical convention', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: ORDER_TYPE.name,
        filters: [{ field: 'orderNo', operator: 'eq', value: 'CRO-1' }],
        include: ['order_legs'],
      })
      .expect(201);

    const order = res.body.data[0];
    expect(order).toBeDefined();
    const legs = order.relationships?.order_legs ?? order.order_legs ?? [];
    // CRO-1 has two legs (L1, L2).
    expect(legs).toHaveLength(2);
  });

  // Field Path filter (Slice 2, ADR-0044): filter legs by a field on the
  // parent order using the dot-path syntax in `field`.
  it('filters legs by parent order field (order_legs.deliveryMode = relay)', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: LEG_TYPE.name,
        filters: [{ field: 'order_legs.deliveryMode', operator: 'eq', value: 'relay' }],
      })
      .expect(201);

    // CRO-1 is relay → 2 legs; CRO-2 is rider_only → 0 legs match.
    expect(res.body.meta.total).toBe(2);
    const extIds = res.body.data.map((r: any) => r.externalId).sort();
    expect(extIds).toEqual(['CRO-1-L1', 'CRO-1-L2']);
  });

  // Slice 3: fkSide direction tests — lock the planner's rejection of the
  // reverse direction (parent→child groupBy when FK is on the parent side).
  it('rejects cross-rel groupBy from the child (many) side toward its parent (fkSide=self)', async () => {
    // order_legs from the ORDER side: order is the source/one-side (fkSide='other'
    // on order's view). That's the SUPPORTED direction (grouping legs by order field).
    // Attempting the reverse: grouping ORDERS by a leg field — leg→order is
    // fkSide='self' on leg's view, so order is NOT the FK-holder → UNSUPPORTED.
    const res = await request(app.getHttpServer())
      .post('/query/aggregate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: ORDER_TYPE.name,
        groupBy: ['order_legs.legNo'],
        metrics: [{ kind: 'count', alias: 'n' }],
      });
    // Should be rejected with CROSS_REL_DIRECTION_UNSUPPORTED (400).
    expect(res.status).toBe(400);
    expect(res.body.error?.code ?? res.body.message).toMatch(/DIRECTION_UNSUPPORTED|UNKNOWN_RELATION/);
  });

  // Positive direction test: groupBy from the many side toward parent (fkSide='self')
  // is the supported case — already proven by the first test above.
  // This test locks the dual: cross-rel aggregate + field path filter in one query.
  it('combines cross-rel groupBy + field path filter correctly', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/aggregate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: LEG_TYPE.name,
        filters: [{ field: 'order_legs.deliveryMode', operator: 'eq', value: 'relay' }],
        groupBy: ['order_legs.deliveryMode'],
        metrics: [{ kind: 'sum', field: 'duration', alias: 'total' }],
      })
      .expect(201);

    // Only relay legs survive the filter → one group.
    expect(res.body.groups).toHaveLength(1);
    expect(res.body.groups[0].key['order_legs.deliveryMode']).toBe('relay');
    expect(Number(res.body.groups[0].metrics.total)).toBe(40);
  });
});
