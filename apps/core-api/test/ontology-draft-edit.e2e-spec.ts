import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '@omaha/db';
import {
  createTestApp,
  ensureTestTenant,
  loginAsTestTenantAdmin,
  cleanupTestTenant,
} from './test-helpers';

/**
 * #70 — edit the Draft for additive (safe) changes and publish them to production:
 * add a field / edit semantic annotations on the Draft, publish, and confirm the new
 * field is immediately queryable at runtime (reads null on pre-existing instances).
 * Publish mutates schema only; instances are never touched.
 */
describe('Edit draft + publish additive changes (#70, e2e)', () => {
  let app: INestApplication;
  let token: string;
  let prisma: PrismaService;
  let tenantId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    tenantId = await ensureTestTenant(app);
    token = await loginAsTestTenantAdmin(app);
  });

  afterAll(async () => {
    await prisma.ontologyDraft.deleteMany({ where: { tenantId } });
    await cleanupTestTenant(app);
    await app.close();
  });

  beforeEach(async () => {
    await cleanupTestTenant(app);
    await prisma.ontologyDraft.deleteMany({ where: { tenantId } });
    await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'widget',
        label: '部件',
        properties: [{ name: 'sku', label: 'SKU', type: 'string', filterable: true }],
      })
      .expect(201);
    // One pre-existing instance, so we can prove publish doesn't touch instance data.
    await prisma.objectInstance.create({
      data: { tenantId, objectType: 'widget', externalId: 'W-1', label: 'Widget One', properties: { sku: 'W-1' } },
    });
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  async function getDraftSnapshot() {
    const res = await request(app.getHttpServer()).get('/ontology/draft').set(auth()).expect(200);
    return res.body.draft.snapshot;
  }

  it('mutating the Draft persists across reads until published', async () => {
    await request(app.getHttpServer()).post('/ontology/draft').set(auth()).expect(200);
    const snap = await getDraftSnapshot();
    const widget = snap.objectTypes.find((t: any) => t.name === 'widget');
    widget.properties.push({ name: 'weight', label: '重量', type: 'number', unit: 'kg', sortable: true });
    widget.description = '一个可装配的部件';

    await request(app.getHttpServer()).put('/ontology/draft').set(auth()).send({ snapshot: snap }).expect(200);

    const reread = await getDraftSnapshot();
    const rw = reread.objectTypes.find((t: any) => t.name === 'widget');
    expect(rw.properties.map((p: any) => p.name)).toEqual(['sku', 'weight']);
    expect(rw.properties.find((p: any) => p.name === 'weight').unit).toBe('kg');
    expect(rw.description).toBe('一个可装配的部件');
  });

  it('publishing an added field applies it to production and it is queryable at runtime (null on old instances)', async () => {
    await request(app.getHttpServer()).post('/ontology/draft').set(auth()).expect(200);
    const snap = await getDraftSnapshot();
    const widget = snap.objectTypes.find((t: any) => t.name === 'widget');
    widget.properties.push({ name: 'weight', label: '重量', type: 'number', unit: 'kg', sortable: true });
    await request(app.getHttpServer()).put('/ontology/draft').set(auth()).send({ snapshot: snap }).expect(200);

    const pub = await request(app.getHttpServer()).post('/ontology/draft/publish').set(auth()).expect(200);
    expect(pub.body.updatedTypes).toContain('widget');

    // Production schema now has the field.
    const ot = await prisma.objectType.findFirst({ where: { tenantId, name: 'widget' } });
    const props = (ot!.properties as any[]).map((p) => p.name);
    expect(props).toContain('weight');

    // Runtime query referencing the new field returns the pre-existing instance; weight reads null/absent.
    const q = await request(app.getHttpServer())
      .post('/query/objects')
      .set(auth())
      .send({ objectType: 'widget', select: ['sku', 'weight'] })
      .expect(201);
    expect(q.body.data.length).toBe(1);
    const row = q.body.data[0];
    expect(row.properties.sku).toBe('W-1');
    expect(row.properties.weight ?? null).toBeNull();
  });

  it('publish mutates schema only — object_instances is never touched', async () => {
    const before = await prisma.objectInstance.findMany({ where: { tenantId }, orderBy: { externalId: 'asc' } });

    await request(app.getHttpServer()).post('/ontology/draft').set(auth()).expect(200);
    const snap = await getDraftSnapshot();
    snap.objectTypes.find((t: any) => t.name === 'widget').properties.push({ name: 'color', label: '颜色', type: 'string' });
    // Also add a brand-new type + relationship (all additive/safe).
    snap.objectTypes.push({ name: 'part', label: '零件', properties: [{ name: 'code', label: '编号', type: 'string' }], derivedProperties: [] });
    snap.relationships.push({ name: 'widget_parts', sourceType: 'widget', targetType: 'part', cardinality: 'one-to-many' });
    await request(app.getHttpServer()).put('/ontology/draft').set(auth()).send({ snapshot: snap }).expect(200);

    const pub = await request(app.getHttpServer()).post('/ontology/draft/publish').set(auth()).expect(200);
    expect(pub.body.createdTypes).toContain('part');
    expect(pub.body.createdRelationships).toContain('widget_parts');

    const after = await prisma.objectInstance.findMany({ where: { tenantId }, orderBy: { externalId: 'asc' } });
    expect(after.map((i) => ({ id: i.id, props: i.properties }))).toEqual(
      before.map((i) => ({ id: i.id, props: i.properties })),
    );
  });

  it('rejects an invalid draft edit (duplicate allowedValues) with 400', async () => {
    await request(app.getHttpServer()).post('/ontology/draft').set(auth()).expect(200);
    const snap = await getDraftSnapshot();
    snap.objectTypes
      .find((t: any) => t.name === 'widget')
      .properties.push({ name: 'grade', label: '等级', type: 'string', allowedValues: ['A', 'A'] });
    await request(app.getHttpServer()).put('/ontology/draft').set(auth()).send({ snapshot: snap }).expect(400);
  });

  it('PUT /ontology/draft without an existing draft returns 404', async () => {
    await request(app.getHttpServer())
      .put('/ontology/draft')
      .set(auth())
      .send({ snapshot: { version: 1, objectTypes: [], relationships: [] } })
      .expect(404);
  });
});
