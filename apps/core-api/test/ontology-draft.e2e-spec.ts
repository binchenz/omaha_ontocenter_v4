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
 * #69 — the thinnest end-to-end tracer through the Draft→Publish spine:
 * seed a Draft from the live ontology (Snapshotter), read it back, publish it
 * UNCHANGED (Flattener round-trip = no net change), and discard. Runs on the
 * isolated `tenant_test` so it never clobbers the seeded demo ontology.
 */
describe('Ontology Draft lifecycle (#69, e2e)', () => {
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
    // Seed a minimal two-type ontology with one relationship to publish against.
    await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'book',
        label: '书籍',
        description: '一本书',
        properties: [
          { name: 'isbn', label: 'ISBN', type: 'string', filterable: true },
          { name: 'price', label: '价格', type: 'number', sortable: true, unit: '元' },
        ],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'chapter', label: '章节', properties: [{ name: 'title', label: '标题', type: 'string' }] })
      .expect(201);
    const types = await prisma.objectType.findMany({ where: { tenantId } });
    const book = types.find((t) => t.name === 'book')!;
    const chapter = types.find((t) => t.name === 'chapter')!;
    await request(app.getHttpServer())
      .post('/ontology/relationships')
      .set('Authorization', `Bearer ${token}`)
      .send({ sourceTypeId: book.id, targetTypeId: chapter.id, name: 'book_chapters', cardinality: 'one-to-many' })
      .expect(201);
  });

  it('GET /ontology/draft is null before any draft exists', async () => {
    const res = await request(app.getHttpServer())
      .get('/ontology/draft')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.draft).toBeNull();
  });

  it('creating a Draft snapshots the published ontology; the API reads it back', async () => {
    await request(app.getHttpServer()).post('/ontology/draft').set('Authorization', `Bearer ${token}`).expect(200);
    const res = await request(app.getHttpServer())
      .get('/ontology/draft')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.draft.status).toBe('editing');
    const snap = res.body.draft.snapshot;
    expect(snap.objectTypes.map((t: any) => t.name).sort()).toEqual(['book', 'chapter']);
    const book = snap.objectTypes.find((t: any) => t.name === 'book');
    expect(book.properties.map((p: any) => p.name)).toEqual(['isbn', 'price']);
    expect(book.properties.find((p: any) => p.name === 'price').unit).toBe('元');
    expect(snap.relationships).toHaveLength(1);
    expect(snap.relationships[0]).toMatchObject({ name: 'book_chapters', sourceType: 'book', targetType: 'chapter' });
    // Snapshot is id-independent.
    expect(book.id).toBeUndefined();
  });

  it('creating a Draft twice is idempotent (exactly one row per tenant)', async () => {
    await request(app.getHttpServer()).post('/ontology/draft').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app.getHttpServer()).post('/ontology/draft').set('Authorization', `Bearer ${token}`).expect(200);
    const count = await prisma.ontologyDraft.count({ where: { tenantId } });
    expect(count).toBe(1);
  });

  it('publishing an UNCHANGED Draft is a no-op round-trip and clears the Draft', async () => {
    const before = await snapshotOf(prisma, tenantId);

    await request(app.getHttpServer()).post('/ontology/draft').set('Authorization', `Bearer ${token}`).expect(200);
    const pub = await request(app.getHttpServer())
      .post('/ontology/draft/publish')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Unchanged draft → only updates, no creates/deletes.
    expect(pub.body.createdTypes).toEqual([]);
    expect(pub.body.deletedTypes).toEqual([]);
    expect(pub.body.createdRelationships).toEqual([]);
    expect(pub.body.deletedRelationships).toEqual([]);

    const after = await snapshotOf(prisma, tenantId);
    expect(after).toEqual(before);

    // Draft is cleared after publish.
    const draft = await request(app.getHttpServer())
      .get('/ontology/draft')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(draft.body.draft).toBeNull();
  });

  it('discarding the Draft removes it, leaving the published ontology intact', async () => {
    const before = await snapshotOf(prisma, tenantId);
    await request(app.getHttpServer()).post('/ontology/draft').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app.getHttpServer()).delete('/ontology/draft').set('Authorization', `Bearer ${token}`).expect(204);

    expect(await prisma.ontologyDraft.count({ where: { tenantId } })).toBe(0);
    expect(await snapshotOf(prisma, tenantId)).toEqual(before);
  });

  it('publishing with no Draft returns 404', async () => {
    await request(app.getHttpServer())
      .post('/ontology/draft/publish')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});

/** A comparable fingerprint of the live ontology (names/labels/props/rels), id-independent. */
async function snapshotOf(prisma: PrismaService, tenantId: string) {
  const types = await prisma.objectType.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
  const rels = await prisma.objectRelationship.findMany({
    where: { tenantId },
    include: { sourceType: true, targetType: true },
    orderBy: { name: 'asc' },
  });
  return {
    types: types.map((t) => ({
      name: t.name,
      label: t.label,
      description: t.description,
      properties: t.properties,
      derivedProperties: t.derivedProperties,
    })),
    rels: rels.map((r) => ({
      name: r.name,
      source: r.sourceType.name,
      target: r.targetType.name,
      cardinality: r.cardinality,
    })),
  };
}
