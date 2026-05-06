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

    const otidHex = flaggedTypeId.replace(/-/g, '');
    const rows = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'object_instances'
       AND indexname LIKE 'idx_oi_${otidHex}_%'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexname).toMatch(new RegExp(`^idx_oi_${otidHex}_sku_f$`));

    const manual = await request(app.getHttpServer())
      .post(`/ontology/types/${flaggedTypeId}/reconcile-indexes`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(manual.body.created).toEqual([]);
    expect(manual.body.dropped).toEqual([]);
    expect(manual.body.kept).toEqual([rows[0].indexname]);

    await request(app.getHttpServer())
      .delete(`/ontology/types/${flaggedTypeId}`)
      .set('Authorization', `Bearer ${token}`);
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
    const otidHex = typeId.replace(/-/g, '');

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
       AND indexname LIKE 'idx_oi_${otidHex}_%'`,
    );
    expect(rows).toEqual([]);

    await request(app.getHttpServer())
      .delete(`/ontology/types/${typeId}`)
      .set('Authorization', `Bearer ${token}`);
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
    const otidHex = typeId.replace(/-/g, '');

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
       AND indexname LIKE 'idx_oi_${otidHex}_%'`,
    );
    const names = rows.map((r) => r.indexname);
    expect(names).toHaveLength(2);
    expect(names.some((n) => /createdAt_s$/.test(n))).toBe(true);
    expect(names.some((n) => /amount_f$/.test(n))).toBe(true);

    await request(app.getHttpServer())
      .delete(`/ontology/types/${typeId}`)
      .set('Authorization', `Bearer ${token}`);
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
    const otidHex = typeId.replace(/-/g, '');

    const afterCreate = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'object_instances'
       AND indexname LIKE 'idx_oi_${otidHex}_%'`,
    );
    expect(afterCreate.length).toBe(1);
    expect(afterCreate[0].indexname).toMatch(/region_f$/);

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
       AND indexname LIKE 'idx_oi_${otidHex}_%'
       ORDER BY indexname`,
    );
    expect(afterUpdate.length).toBe(1);
    expect(afterUpdate[0].indexname).toMatch(/status_f$/);

    await request(app.getHttpServer())
      .delete(`/ontology/types/${typeId}`)
      .set('Authorization', `Bearer ${token}`);
  });

  it('does not drop indexes of a sibling type whose name is a superstring (F3 regression)', async () => {
    const orderRes = await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'recon_order',
        label: 'Recon Order',
        properties: [{ name: 'total', label: 'Total', type: 'number', filterable: true }],
      })
      .expect(201);
    const orderId = orderRes.body.id;

    const orderHistRes = await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'recon_order_history',
        label: 'Recon Order History',
        properties: [{ name: 'total', label: 'Total', type: 'number', filterable: true }],
      })
      .expect(201);
    const orderHistId = orderHistRes.body.id;
    const orderHistOtidHex = orderHistId.replace(/-/g, '');

    const beforeDrop = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'object_instances'
       AND indexname LIKE 'idx_oi_${orderHistOtidHex}_%'`,
    );
    expect(beforeDrop.length).toBe(1);

    await request(app.getHttpServer())
      .put(`/ontology/types/${orderId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        properties: [{ name: 'total', label: 'Total', type: 'number' }],
      })
      .expect(200);

    const afterDrop = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'object_instances'
       AND indexname LIKE 'idx_oi_${orderHistOtidHex}_%'`,
    );
    expect(afterDrop.length).toBe(1);
    expect(afterDrop[0].indexname).toBe(beforeDrop[0].indexname);

    await request(app.getHttpServer())
      .delete(`/ontology/types/${orderId}`)
      .set('Authorization', `Bearer ${token}`);
    await request(app.getHttpServer())
      .delete(`/ontology/types/${orderHistId}`)
      .set('Authorization', `Bearer ${token}`);
  });

  it('self-heals by adopting pre-existing old-style indexes once, then proceeds normally', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'reconcile_test_adopt',
        label: 'Reconcile Test Adopt',
        properties: [{ name: 'code', label: 'Code', type: 'string', filterable: true }],
      })
      .expect(201);
    const typeId = createRes.body.id;
    const otidHex = typeId.replace(/-/g, '');
    const ot = await prisma.objectType.findUnique({ where: { id: typeId } });
    const tenantId = ot!.tenantId;
    const tenantSlug = tenantId.replace(/-/g, '').slice(0, 8);

    await prisma.objectTypeIndex.deleteMany({ where: { tenantId, objectTypeId: typeId } });
    const newStyle = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'object_instances'
       AND indexname LIKE 'idx_oi_${otidHex}_%'`,
    );
    for (const r of newStyle) {
      await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS public."${r.indexname}"`);
    }

    const oldName = `idx_oi_${tenantSlug}_reconcile_test_adopt_code_f`;
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "${oldName}" ON object_instances (tenant_id, object_type, (properties->>'code'))`,
    );

    const first = await request(app.getHttpServer())
      .post(`/ontology/types/${typeId}/reconcile-indexes`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(first.body.kept).toContain(oldName);
    expect(first.body.created).toEqual([]);

    const registryAfter = await prisma.objectTypeIndex.findMany({
      where: { tenantId, objectTypeId: typeId },
    });
    expect(registryAfter).toHaveLength(1);
    expect(registryAfter[0].indexName).toBe(oldName);

    const second = await request(app.getHttpServer())
      .post(`/ontology/types/${typeId}/reconcile-indexes`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(second.body).toEqual({ created: [], dropped: [], kept: [oldName] });

    await request(app.getHttpServer())
      .delete(`/ontology/types/${typeId}`)
      .set('Authorization', `Bearer ${token}`);
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS public."${oldName}"`);
  });

  it('serializes concurrent reconciles on the same (tenant, type) and returns consistent results', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'reconcile_test_concurrent',
        label: 'Reconcile Test Concurrent',
        properties: [
          { name: 'a', label: 'A', type: 'string', filterable: true },
          { name: 'b', label: 'B', type: 'string', filterable: true },
        ],
      })
      .expect(201);
    const typeId = createRes.body.id;
    const otidHex = typeId.replace(/-/g, '');

    const [r1, r2, r3] = await Promise.all([
      request(app.getHttpServer())
        .post(`/ontology/types/${typeId}/reconcile-indexes`)
        .set('Authorization', `Bearer ${token}`),
      request(app.getHttpServer())
        .post(`/ontology/types/${typeId}/reconcile-indexes`)
        .set('Authorization', `Bearer ${token}`),
      request(app.getHttpServer())
        .post(`/ontology/types/${typeId}/reconcile-indexes`)
        .set('Authorization', `Bearer ${token}`),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200);

    const final = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'object_instances'
       AND indexname LIKE 'idx_oi_${otidHex}_%'`,
    );
    expect(final).toHaveLength(2);

    const ot = await prisma.objectType.findUnique({ where: { id: typeId } });
    const registry = await prisma.objectTypeIndex.findMany({
      where: { tenantId: ot!.tenantId, objectTypeId: typeId },
    });
    expect(registry).toHaveLength(2);

    await request(app.getHttpServer())
      .delete(`/ontology/types/${typeId}`)
      .set('Authorization', `Bearer ${token}`);
  });

  it('drops indexes and registry rows when the ObjectType is deleted (F11 regression)', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'reconcile_test_delete',
        label: 'Reconcile Test Delete',
        properties: [{ name: 'status', label: 'Status', type: 'string', filterable: true }],
      })
      .expect(201);
    const typeId = createRes.body.id;
    const otidHex = typeId.replace(/-/g, '');
    const ot = await prisma.objectType.findUnique({ where: { id: typeId } });
    const tenantId = ot!.tenantId;

    const beforeDelete = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'object_instances'
       AND indexname LIKE 'idx_oi_${otidHex}_%'`,
    );
    expect(beforeDelete).toHaveLength(1);
    const registryBefore = await prisma.objectTypeIndex.findMany({
      where: { tenantId, objectTypeId: typeId },
    });
    expect(registryBefore).toHaveLength(1);

    await request(app.getHttpServer())
      .delete(`/ontology/types/${typeId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const afterDelete = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'object_instances'
       AND indexname LIKE 'idx_oi_${otidHex}_%'`,
    );
    expect(afterDelete).toEqual([]);
    const registryAfter = await prisma.objectTypeIndex.findMany({
      where: { tenantId, objectTypeId: typeId },
    });
    expect(registryAfter).toEqual([]);
  });

  it('dropAllFor on a non-existent (tenant, type) returns empty list without throwing', async () => {
    const indexManager = app.get(
      (await import('../src/modules/ontology/index-manager.service')).IndexManagerService,
    );
    const ghostTenantId = '00000000-0000-0000-0000-000000000000';
    const ghostTypeId = '11111111-1111-1111-1111-111111111111';
    const result = await indexManager.dropAllFor(ghostTenantId, ghostTypeId);
    expect(result).toEqual([]);
  });
});
