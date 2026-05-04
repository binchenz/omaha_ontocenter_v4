import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@omaha/db';
import { createTestApp, loginAsAdmin } from './test-helpers';

describe('IndexManager reconcile (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let prisma: PrismaClient;
  let objectTypeId: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await loginAsAdmin(app);
    prisma = new PrismaClient();

    const res = await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'reconcile_test_bare',
        label: 'Reconcile Test Bare',
        properties: [
          { name: 'sku', label: 'SKU', type: 'string' },
          { name: 'price', label: 'Price', type: 'number' },
        ],
      });
    objectTypeId = res.body.id;
  });

  afterAll(async () => {
    await request(app.getHttpServer())
      .delete(`/ontology/types/${objectTypeId}`)
      .set('Authorization', `Bearer ${token}`);
    await prisma.$disconnect();
    await app.close();
  });

  it('returns empty diff for an ObjectType with no filterable/sortable flags', async () => {
    const res = await request(app.getHttpServer())
      .post(`/ontology/types/${objectTypeId}/reconcile-indexes`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual({ created: [], dropped: [], kept: [] });

    const rows = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'object_instances'
       AND indexname LIKE 'idx_oi_%'`,
    );
    const relatedToThisType = rows.filter((r: { indexname: string }) =>
      r.indexname.includes('reconcile_test_bare'),
    );
    expect(relatedToThisType).toEqual([]);
  });

  it('creates an expression index when a property is flagged filterable', async () => {
    const flaggedTypeRes = await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'reconcile_test_flagged',
        label: 'Reconcile Test Flagged',
        properties: [
          { name: 'sku', label: 'SKU', type: 'string', filterable: true },
          { name: 'price', label: 'Price', type: 'number' },
        ],
      })
      .expect(201);
    const flaggedTypeId = flaggedTypeRes.body.id;

    try {
      const rows = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = 'object_instances'
         AND indexname LIKE 'idx_oi_%reconcile_test_flagged%'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].indexname).toMatch(/^idx_oi_.*reconcile_test_flagged.*sku.*_f$/);

      const manual = await request(app.getHttpServer())
        .post(`/ontology/types/${flaggedTypeId}/reconcile-indexes`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(manual.body.created).toEqual([]);
      expect(manual.body.dropped).toEqual([]);
      expect(manual.body.kept).toEqual([rows[0].indexname]);
    } finally {
      await request(app.getHttpServer())
        .delete(`/ontology/types/${flaggedTypeId}`)
        .set('Authorization', `Bearer ${token}`);
      const orphans = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = 'object_instances'
         AND indexname LIKE 'idx_oi_%reconcile_test_flagged%'`,
      );
      for (const o of orphans) {
        await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS public."${o.indexname}"`);
      }
    }
  });

  it('drops the index when the flag is removed, and is idempotent across repeated calls', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'reconcile_test_toggle',
        label: 'Reconcile Test Toggle',
        properties: [
          { name: 'city', label: 'City', type: 'string', filterable: true },
        ],
      })
      .expect(201);
    const typeId = createRes.body.id;

    try {
      const first = await request(app.getHttpServer())
        .post(`/ontology/types/${typeId}/reconcile-indexes`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(first.body.created).toEqual([]);
      expect(first.body.kept).toHaveLength(1);

      const second = await request(app.getHttpServer())
        .post(`/ontology/types/${typeId}/reconcile-indexes`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(second.body).toEqual({ created: [], dropped: [], kept: first.body.kept });

      await request(app.getHttpServer())
        .put(`/ontology/types/${typeId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          properties: [
            { name: 'city', label: 'City', type: 'string' },
          ],
        })
        .expect(200);

      const rows = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = 'object_instances'
         AND indexname LIKE 'idx_oi_%reconcile_test_toggle%'`,
      );
      expect(rows).toEqual([]);
    } finally {
      await request(app.getHttpServer())
        .delete(`/ontology/types/${typeId}`)
        .set('Authorization', `Bearer ${token}`);
      const orphans = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = 'object_instances'
         AND indexname LIKE 'idx_oi_%reconcile_test_toggle%'`,
      );
      for (const o of orphans) {
        await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS public."${o.indexname}"`);
      }
    }
  });

  it('creates a sortable index distinct from the filterable index, and persists precision/scale', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'reconcile_test_dims',
        label: 'Reconcile Test Dims',
        properties: [
          { name: 'createdAt', label: 'Created', type: 'date', sortable: true },
          {
            name: 'amount',
            label: 'Amount',
            type: 'number',
            filterable: true,
            precision: 12,
            scale: 2,
          },
        ],
      })
      .expect(201);
    const typeId = createRes.body.id;

    try {
      const getRes = await request(app.getHttpServer())
        .get(`/ontology/types/${typeId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const amount = getRes.body.properties.find((p: { name: string }) => p.name === 'amount');
      expect(amount.precision).toBe(12);
      expect(amount.scale).toBe(2);
      expect(amount.filterable).toBe(true);

      const rows = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = 'object_instances'
         AND indexname LIKE 'idx_oi_%reconcile_test_dims%'`,
      );
      const names = rows.map((r) => r.indexname);
      expect(names).toHaveLength(2);
      expect(names.some((n) => /createdAt.*_s$/.test(n))).toBe(true);
      expect(names.some((n) => /amount.*_f$/.test(n))).toBe(true);
    } finally {
      await request(app.getHttpServer())
        .delete(`/ontology/types/${typeId}`)
        .set('Authorization', `Bearer ${token}`);
      const orphans = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = 'object_instances'
         AND indexname LIKE 'idx_oi_%reconcile_test_dims%'`,
      );
      for (const o of orphans) {
        await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS public."${o.indexname}"`);
      }
    }
  });

  it('reconciles indexes automatically on ObjectType create and update', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'reconcile_test_auto',
        label: 'Reconcile Test Auto',
        properties: [
          { name: 'region', label: 'Region', type: 'string', filterable: true },
        ],
      })
      .expect(201);
    const typeId = createRes.body.id;

    try {
      const afterCreate = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = 'object_instances'
         AND indexname LIKE 'idx_oi_%reconcile_test_auto%'`,
      );
      expect(afterCreate.length).toBe(1);
      expect(afterCreate[0].indexname).toMatch(/region.*_f$/);

      await request(app.getHttpServer())
        .put(`/ontology/types/${typeId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          properties: [
            { name: 'region', label: 'Region', type: 'string' },
            { name: 'status', label: 'Status', type: 'string', filterable: true },
          ],
        })
        .expect(200);

      const afterUpdate = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = 'object_instances'
         AND indexname LIKE 'idx_oi_%reconcile_test_auto%'
         ORDER BY indexname`,
      );
      expect(afterUpdate.length).toBe(1);
      expect(afterUpdate[0].indexname).toMatch(/status.*_f$/);
    } finally {
      await request(app.getHttpServer())
        .delete(`/ontology/types/${typeId}`)
        .set('Authorization', `Bearer ${token}`);
      const orphans = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = 'object_instances'
         AND indexname LIKE 'idx_oi_%reconcile_test_auto%'`,
      );
      for (const o of orphans) {
        await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS public."${o.indexname}"`);
      }
    }
  });
});
