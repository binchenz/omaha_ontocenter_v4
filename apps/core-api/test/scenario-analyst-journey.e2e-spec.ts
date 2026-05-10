/**
 * Scenario 1: Financial analyst user journey
 *
 * Story: An analyst onboards to the platform with a fresh schema, bulk-imports
 * Q4 sales data, runs multi-dimensional aggregations, discovers a data error,
 * fixes it via Apply, then evolves the schema to track a new metric.
 *
 * Exercises: Apply layer (bulk create/update/delete), materialized view
 * auto-refresh, QueryPlanner view detection, aggregate pipeline, schema
 * evolution triggering view rebuild, read-after-write consistency.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@omaha/db';
import { createTestApp, ensureTestTenant, loginAsTestTenantAdmin, cleanupTestTenant } from './test-helpers';
import { ApplyService } from '../src/modules/apply/apply.service';
import { ViewManagerService } from '../src/modules/ontology/view-manager.service';
import type { ObjectEdit, ApplyContext } from '@omaha/shared-types';

describe('Scenario: Analyst user journey (e2e)', () => {
  jest.setTimeout(30_000);
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let token: string;
  let applyService: ApplyService;
  let viewManager: ViewManagerService;

  const TYPE = 'analyst_q4_order';

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaClient();
    tenantId = await ensureTestTenant(app);
    token = await loginAsTestTenantAdmin(app);
    applyService = app.get(ApplyService);
    viewManager = app.get(ViewManagerService);

    await prisma.objectInstance.deleteMany({ where: { tenantId, objectType: TYPE } });
    const existing = await prisma.objectType.findFirst({ where: { tenantId, name: TYPE } });
    if (existing) await prisma.objectType.delete({ where: { id: existing.id } });
    await viewManager.drop(tenantId, TYPE).catch(() => {});
  });

  afterAll(async () => {
    await prisma.objectInstance.deleteMany({ where: { tenantId, objectType: TYPE } });
    const existing = await prisma.objectType.findFirst({ where: { tenantId, name: TYPE } });
    if (existing) await prisma.objectType.delete({ where: { id: existing.id } });
    await viewManager.drop(tenantId, TYPE).catch(() => {});
    await cleanupTestTenant(app);
    await prisma.$disconnect();
    await app.close();
  });

  const ctx = (): ApplyContext => ({ tenantId, userId: 'analyst-user' });

  it('step 1: analyst creates a new objectType for Q4 orders', async () => {
    await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: TYPE,
        label: 'Q4 Sales Orders',
        properties: [
          { name: 'orderNo', type: 'string', label: 'Order No', filterable: true, sortable: true },
          { name: 'region', type: 'string', label: 'Region', filterable: true },
          { name: 'product', type: 'string', label: 'Product', filterable: true },
          { name: 'amount', type: 'number', label: 'Amount', filterable: true, sortable: true },
          { name: 'quarter', type: 'string', label: 'Quarter', filterable: true },
        ],
      })
      .expect(201);

    // Verify materialized view was created
    expect(await viewManager.exists(tenantId, TYPE)).toBe(true);
  });

  it('step 2: bulk import 12 Q4 orders via Apply layer (single transaction)', async () => {
    const orders: Array<{ orderNo: string; region: string; product: string; amount: number }> = [
      { orderNo: 'Q4-001', region: '华东', product: 'Widget-A', amount: 50000 },
      { orderNo: 'Q4-002', region: '华东', product: 'Widget-A', amount: 30000 },
      { orderNo: 'Q4-003', region: '华东', product: 'Widget-B', amount: 75000 },
      { orderNo: 'Q4-004', region: '华北', product: 'Widget-A', amount: 45000 },
      { orderNo: 'Q4-005', region: '华北', product: 'Widget-B', amount: 20000 },
      { orderNo: 'Q4-006', region: '华北', product: 'Widget-C', amount: 10000 },
      { orderNo: 'Q4-007', region: '华南', product: 'Widget-A', amount: 60000 },
      { orderNo: 'Q4-008', region: '华南', product: 'Widget-B', amount: 35000 },
      { orderNo: 'Q4-009', region: '华南', product: 'Widget-C', amount: 25000 },
      { orderNo: 'Q4-010', region: '西部', product: 'Widget-A', amount: 15000 },
      { orderNo: 'Q4-011', region: '西部', product: 'Widget-B', amount: 12000 },
      { orderNo: 'Q4-012', region: '西部', product: 'Widget-C', amount: 8000 },
    ];

    const edits: ObjectEdit[] = orders.map(o => ({
      op: 'create',
      objectType: TYPE,
      properties: { ...o, quarter: 'Q4-2024' },
      externalId: o.orderNo,
      label: `${o.product} - ${o.region}`,
    }));

    const result = await applyService.apply(edits, ctx());

    expect(result.applied).toBe(12);
    expect(result.created).toHaveLength(12);
    expect(result.errors).toBeUndefined();
  });

  it('step 3: read-after-write — query immediately returns all 12 orders', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: TYPE,
        filters: [{ field: 'quarter', operator: 'eq', value: 'Q4-2024' }],
        page: 1,
        pageSize: 20,
      })
      .expect(201);

    expect(res.body.data).toHaveLength(12);
    expect(res.body.meta.total).toBe(12);
  });

  it('step 4: aggregate revenue by region with ranking', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/aggregate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: TYPE,
        filters: [{ field: 'quarter', operator: 'eq', value: 'Q4-2024' }],
        groupBy: ['region'],
        metrics: [
          { kind: 'count', alias: 'orders' },
          { kind: 'sum', field: 'amount', alias: 'revenue' },
          { kind: 'avg', field: 'amount', alias: 'avgOrder' },
        ],
        orderBy: [{ kind: 'metric', by: 'revenue', direction: 'desc' }],
      })
      .expect(201);

    expect(res.body.groups).toHaveLength(4);

    // 华东: 50000+30000+75000 = 155000 → rank 1
    const byRegion = Object.fromEntries(
      res.body.groups.map((g: any) => [g.key.region, g.metrics]),
    );
    expect(Number(byRegion['华东'].revenue)).toBe(155000);
    expect(Number(byRegion['华南'].revenue)).toBe(120000);
    expect(Number(byRegion['华北'].revenue)).toBe(75000);
    expect(Number(byRegion['西部'].revenue)).toBe(35000);

    // First group by revenue DESC must be 华东
    expect(res.body.groups[0].key.region).toBe('华东');
  });

  it('step 5: top-selling product per region — cross-dimensional group', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/aggregate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: TYPE,
        filters: [{ field: 'quarter', operator: 'eq', value: 'Q4-2024' }],
        groupBy: ['region', 'product'],
        metrics: [{ kind: 'sum', field: 'amount', alias: 'revenue' }],
        orderBy: [{ kind: 'metric', by: 'revenue', direction: 'desc' }],
      })
      .expect(201);

    // 11 distinct (region, product) combos — note 华东 has Widget-A x2 (Q4-001+Q4-002) merged
    expect(res.body.groups).toHaveLength(11);
    // Top group by revenue: 华东 Widget-A = 50000+30000 = 80000 (beats 华东 Widget-B at 75000)
    expect(res.body.groups[0].key.region).toBe('华东');
    expect(res.body.groups[0].key.product).toBe('Widget-A');
    expect(Number(res.body.groups[0].metrics.revenue)).toBe(80000);
  });

  it('step 6: analyst discovers data error — bulk correction via Apply (update)', async () => {
    // Q4-003 amount was reported wrong: actual was 85000, not 75000
    // Q4-007 was duplicate entry — should be deleted
    const q003 = await prisma.objectInstance.findFirst({ where: { tenantId, externalId: 'Q4-003' } });
    const q007 = await prisma.objectInstance.findFirst({ where: { tenantId, externalId: 'Q4-007' } });

    const corrections: ObjectEdit[] = [
      {
        op: 'update',
        objectId: q003!.id,
        properties: { orderNo: 'Q4-003', region: '华东', product: 'Widget-B', amount: 85000, quarter: 'Q4-2024' },
      },
      { op: 'delete', objectId: q007!.id },
    ];

    const result = await applyService.apply(corrections, ctx());
    expect(result.applied).toBe(2);

    // Verify 华东 revenue now reflects corrected amount: 50000+30000+85000 = 165000
    const res = await request(app.getHttpServer())
      .post('/query/aggregate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: TYPE,
        filters: [
          { field: 'quarter', operator: 'eq', value: 'Q4-2024' },
          { field: 'region', operator: 'eq', value: '华东' },
        ],
        metrics: [{ kind: 'sum', field: 'amount', alias: 'revenue' }],
      })
      .expect(201);
    expect(Number(res.body.groups[0].metrics.revenue)).toBe(165000);

    // Verify Q4-007 is gone
    const count = await request(app.getHttpServer())
      .post('/query/aggregate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: TYPE,
        filters: [{ field: 'quarter', operator: 'eq', value: 'Q4-2024' }],
        metrics: [{ kind: 'count', alias: 'n' }],
      })
      .expect(201);
    expect(count.body.groups[0].metrics.n).toBe(11);
  });

  it('step 7: atomicity — one bad edit rolls back the whole batch', async () => {
    const q001 = await prisma.objectInstance.findFirst({ where: { tenantId, externalId: 'Q4-001' } });
    const priorAmount = (q001!.properties as any).amount;

    const badBatch: ObjectEdit[] = [
      {
        op: 'update',
        objectId: q001!.id,
        properties: { orderNo: 'Q4-001', region: '华东', product: 'Widget-A', amount: 999999, quarter: 'Q4-2024' },
      },
      { op: 'update', objectId: '00000000-0000-0000-0000-000000000000', properties: { x: 1 } },
    ];

    const result = await applyService.apply(badBatch, ctx());
    expect(result.applied).toBe(0);
    expect(result.errors).toHaveLength(1);

    // Q4-001 must still have its pre-batch amount (rollback)
    const q001After = await prisma.objectInstance.findUnique({ where: { id: q001!.id } });
    expect((q001After!.properties as any).amount).toBe(priorAmount);
  });

  it('step 8: schema evolution — add "discount" column, view rebuilds', async () => {
    const type = await prisma.objectType.findFirst({ where: { tenantId, name: TYPE } });

    await request(app.getHttpServer())
      .put(`/ontology/types/${type!.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        label: 'Q4 Sales Orders',
        properties: [
          { name: 'orderNo', type: 'string', label: 'Order No', filterable: true, sortable: true },
          { name: 'region', type: 'string', label: 'Region', filterable: true },
          { name: 'product', type: 'string', label: 'Product', filterable: true },
          { name: 'amount', type: 'number', label: 'Amount', filterable: true, sortable: true },
          { name: 'quarter', type: 'string', label: 'Quarter', filterable: true },
          { name: 'discount', type: 'number', label: 'Discount', filterable: true, sortable: true },
        ],
      })
      .expect(200);

    // View still exists after schema change
    expect(await viewManager.exists(tenantId, TYPE)).toBe(true);

    // Pre-existing rows still queryable (discount is null for them)
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: TYPE,
        filters: [{ field: 'quarter', operator: 'eq', value: 'Q4-2024' }],
        page: 1,
        pageSize: 20,
      })
      .expect(201);
    expect(res.body.data.length).toBe(11);
  });

  it('step 9: apply discounts to large orders — filter new column after backfill', async () => {
    // Analyst backfills discount = 10% for orders > 50000
    const largeOrders = await prisma.objectInstance.findMany({
      where: { tenantId, objectType: TYPE, deletedAt: null },
    });
    const edits: ObjectEdit[] = largeOrders
      .filter(o => ((o.properties as any).amount as number) > 50000)
      .map(o => ({
        op: 'update' as const,
        objectId: o.id,
        properties: {
          ...(o.properties as Record<string, unknown>),
          discount: Math.round(((o.properties as any).amount as number) * 0.1),
        },
      }));

    expect(edits.length).toBeGreaterThan(0);
    const result = await applyService.apply(edits, ctx());
    expect(result.applied).toBe(edits.length);

    // Filter by the new discount column — should return only the backfilled rows
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: TYPE,
        filters: [{ field: 'discount', operator: 'gt', value: 0 }],
        sort: { field: 'amount', direction: 'desc' },
      })
      .expect(201);

    expect(res.body.data.length).toBe(edits.length);
    // Every returned row must actually have a positive discount
    for (const row of res.body.data) {
      expect(Number(row.properties.discount)).toBeGreaterThan(0);
    }
  });
});
