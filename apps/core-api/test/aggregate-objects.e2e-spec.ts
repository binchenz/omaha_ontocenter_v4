/**
 * Aggregate_objects e2e — slice #40 (count-only, no groupBy).
 * Subsequent slices (#41–#44) will append more `it` blocks here.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@omaha/db';
import { createTestApp, loginAsAdmin } from './test-helpers';

describe('aggregate_objects (e2e) — count-only tracer', () => {
  let app: INestApplication;
  let token: string;
  let prisma: PrismaClient;
  let demoTenantId: string;

  // Distinct-prefix externalIds so this suite doesn't collide with other tests.
  const TEST_EXTERNAL_IDS = ['AGG-T-001', 'AGG-T-002', 'AGG-T-003'];

  beforeAll(async () => {
    app = await createTestApp();
    token = await loginAsAdmin(app);
    prisma = new PrismaClient();
    demoTenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: 'demo' } })).id;

    await prisma.objectInstance.deleteMany({
      where: { tenantId: demoTenantId, externalId: { in: TEST_EXTERNAL_IDS } },
    });
    await prisma.objectInstance.createMany({
      data: [
        {
          tenantId: demoTenantId,
          objectType: 'order',
          externalId: 'AGG-T-001',
          label: 'agg-tracer-1',
          properties: { orderNo: 'AGG-T-001', status: 'completed' },
          relationships: {},
        },
        {
          tenantId: demoTenantId,
          objectType: 'order',
          externalId: 'AGG-T-002',
          label: 'agg-tracer-2',
          properties: { orderNo: 'AGG-T-002', status: 'completed' },
          relationships: {},
        },
        {
          tenantId: demoTenantId,
          objectType: 'order',
          externalId: 'AGG-T-003',
          label: 'agg-tracer-3',
          properties: { orderNo: 'AGG-T-003', status: 'pending' },
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

  describe('happy path', () => {
    it('count-only, no groupBy returns one group with count', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/aggregate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'order',
          filters: [{ field: 'orderNo', operator: 'contains', value: 'AGG-T-' }],
          metrics: [{ kind: 'count', alias: 'n' }],
        })
        .expect(201);

      expect(res.body.groups).toHaveLength(1);
      expect(res.body.groups[0].key).toEqual({});
      expect(res.body.groups[0].metrics.n).toBe(3);
      expect(res.body.truncated).toBe(false);
      expect(res.body.nextPageToken).toBeNull();
      expect(res.body.totalGroupsEstimate).toBe(1);
    });

    it('count with filter narrows the result', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/aggregate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'order',
          filters: [
            { field: 'orderNo', operator: 'contains', value: 'AGG-T-' },
            { field: 'status', operator: 'eq', value: 'completed' },
          ],
          metrics: [{ kind: 'count', alias: 'n' }],
        })
        .expect(201);
      expect(res.body.groups[0].metrics.n).toBe(2);
    });
  });

  describe('validation errors', () => {
    it('rejects empty metrics with METRICS_REQUIRED', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/aggregate')
        .set('Authorization', `Bearer ${token}`)
        .send({ objectType: 'order', metrics: [] })
        .expect(400);
      expect(res.body.error?.code ?? res.body.code).toBe('METRICS_REQUIRED');
    });

    it('rejects missing metrics field with METRICS_REQUIRED', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/aggregate')
        .set('Authorization', `Bearer ${token}`)
        .send({ objectType: 'order' })
        .expect(400);
      expect(res.body.error?.code ?? res.body.code).toBe('METRICS_REQUIRED');
    });

    it('rejects metric with empty alias', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/aggregate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'order',
          metrics: [{ kind: 'count', alias: '' }],
        })
        .expect(400);
      // any 400 is fine here — class-validator message
      expect(res.status).toBe(400);
    });
  });

  describe('audit', () => {
    it('writes object.aggregate audit entry; result_count reflects groups.length, not metric values', async () => {
      const before = Date.now();
      await request(app.getHttpServer())
        .post('/query/aggregate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'order',
          filters: [{ field: 'orderNo', operator: 'contains', value: 'AGG-T-' }],
          metrics: [{ kind: 'count', alias: 'n' }],
        })
        .expect(201);

      const audit = await prisma.auditLog.findFirst({
        where: {
          tenantId: demoTenantId,
          operation: 'object.aggregate',
          createdAt: { gte: new Date(before - 1000) },
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(audit).toBeTruthy();
      expect(audit!.operation).toBe('object.aggregate');
      expect(audit!.objectType).toBe('order');
      expect(audit!.resultCount).toBe(1); // groups.length, NOT the count of 3
    });
  });

  // ============================================================
  // Slice #41: groupBy single-field + PROPERTY_NOT_GROUPABLE
  // ============================================================
  describe('groupBy (single field)', () => {
    it('returns one group per distinct value of the groupBy field', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/aggregate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'order',
          filters: [{ field: 'orderNo', operator: 'contains', value: 'AGG-T-' }],
          groupBy: ['status'],
          metrics: [{ kind: 'count', alias: 'n' }],
        })
        .expect(201);

      // 2 completed + 1 pending → 2 groups
      expect(res.body.groups).toHaveLength(2);
      const byStatus = Object.fromEntries(
        res.body.groups.map((g: { key: { status: string }; metrics: { n: number } }) => [g.key.status, g.metrics.n])
      );
      expect(byStatus.completed).toBe(2);
      expect(byStatus.pending).toBe(1);
    });

    it('group key is an object with the groupBy field as key (forward-compat for multi-field)', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/aggregate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'order',
          filters: [{ field: 'orderNo', operator: 'contains', value: 'AGG-T-' }],
          groupBy: ['status'],
          metrics: [{ kind: 'count', alias: 'n' }],
        })
        .expect(201);
      // Each group's `key` must be an object, NOT a bare string.
      for (const g of res.body.groups) {
        expect(typeof g.key).toBe('object');
        expect('status' in g.key).toBe(true);
      }
    });

    it('rejects groupBy on a non-filterable property with PROPERTY_NOT_GROUPABLE', async () => {
      // 'phone' is declared on customer but NOT filterable per the demo seed.
      const res = await request(app.getHttpServer())
        .post('/query/aggregate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'customer',
          groupBy: ['phone'],
          metrics: [{ kind: 'count', alias: 'n' }],
        })
        .expect(400);
      expect(res.body.error?.code ?? res.body.code).toBe('PROPERTY_NOT_GROUPABLE');
      expect(JSON.stringify(res.body)).toMatch(/search/i); // hint mentions search fallback
    });
  });

  // ============================================================
  // Slice #42: sum/avg/min/max + METRIC_INVALID_FIELD_TYPE
  // ============================================================
  describe('numeric metrics', () => {
    it('sum + count + avg + min + max combined, no groupBy', async () => {
      // demo seed has these pre-existing:
      //   O2024001 totalAmount=75000
      //   O2024002 totalAmount=25000
      const res = await request(app.getHttpServer())
        .post('/query/aggregate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'order',
          filters: [{ field: 'orderNo', operator: 'contains', value: 'O2024' }],
          metrics: [
            { kind: 'count', alias: 'n' },
            { kind: 'sum', field: 'totalAmount', alias: 'total' },
            { kind: 'avg', field: 'totalAmount', alias: 'avg' },
            { kind: 'min', field: 'totalAmount', alias: 'min' },
            { kind: 'max', field: 'totalAmount', alias: 'max' },
          ],
        })
        .expect(201);
      expect(res.body.groups).toHaveLength(1);
      const m = res.body.groups[0].metrics;
      expect(m.n).toBe(2);
      expect(Number(m.total)).toBe(100000);
      expect(Number(m.avg)).toBe(50000);
      expect(Number(m.min)).toBe(25000);
      expect(Number(m.max)).toBe(75000);
    });

    it('avg ignores rows with NULL value (Postgres default)', async () => {
      // AGG-T-* rows have no totalAmount; result still 50000 from the 2 O2024 rows.
      const res = await request(app.getHttpServer())
        .post('/query/aggregate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'order',
          metrics: [{ kind: 'avg', field: 'totalAmount', alias: 'avg' }],
        })
        .expect(201);
      expect(Number(res.body.groups[0].metrics.avg)).toBe(50000);
    });

    it('rejects sum on a non-numeric field with METRIC_INVALID_FIELD_TYPE', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/aggregate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'order',
          metrics: [{ kind: 'sum', field: 'status', alias: 'sum_status' }],
        })
        .expect(400);
      expect(res.body.error?.code ?? res.body.code).toBe('METRIC_INVALID_FIELD_TYPE');
      expect(JSON.stringify(res.body)).toMatch(/totalAmount/i);
    });
  });

  // ============================================================
  // Slice #43: countDistinct + multi-field groupBy
  // ============================================================
  describe('countDistinct + multi-field groupBy', () => {
    it('countDistinct on a string field counts distinct values', async () => {
      // Demo tenant orders: O2024001 (status=已完成), O2024002 (status=进行中),
      // AGG-T-001/002 (status=completed), AGG-T-003 (status=pending) → 4 distinct
      const res = await request(app.getHttpServer())
        .post('/query/aggregate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'order',
          metrics: [
            { kind: 'count', alias: 'n_rows' },
            { kind: 'countDistinct', field: 'status', alias: 'n_status' },
          ],
        })
        .expect(201);
      expect(res.body.groups).toHaveLength(1);
      expect(Number(res.body.groups[0].metrics.n_status)).toBe(4);
    });

    it('multi-field groupBy returns composite key objects', async () => {
      // 3 AGG-T-* rows, each unique on (status, orderNo) → 3 groups
      const res = await request(app.getHttpServer())
        .post('/query/aggregate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'order',
          filters: [{ field: 'orderNo', operator: 'contains', value: 'AGG-T-' }],
          groupBy: ['status', 'orderNo'],
          metrics: [{ kind: 'count', alias: 'n' }],
        })
        .expect(201);
      expect(res.body.groups).toHaveLength(3);
      for (const g of res.body.groups) {
        expect('status' in g.key).toBe(true);
        expect('orderNo' in g.key).toBe(true);
        expect(g.metrics.n).toBe(1);
      }
    });
  });
});
