import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '@omaha/db';
import { ConnectorClient } from '../src/modules/agent/connector/connector-client.service';
import {
  createTestApp,
  ensureTestTenant,
  loginAsTestTenantAdmin,
  cleanupTestTenant,
} from './test-helpers';

/**
 * #71 — whole-database reverse-inference + provenance. Creates real fixture tables with
 * FK + UNIQUE constraints in the dev Postgres, points a connector at it, runs the actual
 * information_schema introspection (FK / unique-index / declared-type reads), and asserts
 * the produced Draft snapshot carries correct provenance tags. Drops the fixtures after.
 *
 * Fixture tables use a `ri_` prefix so assertions ignore the platform's own public tables.
 */
describe('Reverse-inference + provenance (#71, e2e)', () => {
  let app: INestApplication;
  let token: string;
  let prisma: PrismaService;
  let tenantId: string;
  let connectorId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    tenantId = await ensureTestTenant(app);
    token = await loginAsTestTenantAdmin(app);

    // Real fixture tables with a FK (ri_book.author_id → ri_author.id) and unique columns.
    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS ri_book CASCADE');
    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS ri_author CASCADE');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE ri_author (
        id uuid PRIMARY KEY,
        name varchar(100) NOT NULL,
        email varchar(200) UNIQUE
      )`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE ri_book (
        id uuid PRIMARY KEY,
        isbn varchar(13) UNIQUE NOT NULL,
        price decimal(10,2),
        published_at timestamp,
        author_id uuid NOT NULL REFERENCES ri_author(id)
      )`);

    // Connector pointing at the SAME dev DB (reverse-inference reads its public schema).
    const cc = app.get(ConnectorClient);
    const url = new URL(process.env.DATABASE_URL!);
    const connector = await prisma.connector.create({
      data: {
        tenantId,
        name: 'ri-fixture',
        type: 'postgresql',
        config: {
          host: url.hostname,
          port: Number(url.port || 5432),
          user: decodeURIComponent(url.username),
          password: cc.encrypt(decodeURIComponent(url.password)),
          database: url.pathname.replace(/^\//, ''),
        },
      },
    });
    connectorId = connector.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.ontologyDraft.deleteMany({ where: { tenantId } });
    await prisma.connector.deleteMany({ where: { tenantId } });
    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS ri_book CASCADE');
    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS ri_author CASCADE');
    await cleanupTestTenant(app);
    await app.close();
  });

  it('reads FK / unique / declared types and produces a provenance-tagged Draft', async () => {
    await prisma.ontologyDraft.deleteMany({ where: { tenantId } });
    const res = await request(app.getHttpServer())
      .post('/reverse-inference')
      .set({ Authorization: `Bearer ${token}` })
      .send({ connectorId })
      .expect(201);

    expect(res.body.snapshot).toBeDefined();
    const snap = res.body.snapshot;
    const author = snap.objectTypes.find((t: any) => t.name === 'ri_author');
    const book = snap.objectTypes.find((t: any) => t.name === 'ri_book');
    expect(author).toBeDefined();
    expect(book).toBeDefined();

    // Declared types → metadata-tagged, correct ontology types.
    const price = book.properties.find((p: any) => p.name === 'price');
    expect(price.type).toBe('number');
    expect(price.provenance).toBe('metadata');
    const publishedAt = book.properties.find((p: any) => p.name === 'published_at');
    expect(publishedAt.type).toBe('date');
    const isbn = book.properties.find((p: any) => p.name === 'isbn');
    expect(isbn.type).toBe('string');
    expect(isbn.required).toBe(true); // NOT NULL

    // FK column is not a plain property; it's the relationship.
    expect(book.properties.map((p: any) => p.name)).not.toContain('author_id');
    const rel = snap.relationships.find((r: any) => r.sourceType === 'ri_author' && r.targetType === 'ri_book');
    expect(rel).toBeDefined();
    expect(rel.cardinality).toBe('one-to-many');
    expect(rel.provenance).toBe('metadata');

    // Unique columns offered as externalId candidates.
    expect(book.externalIdCandidates).toContain('isbn');
    expect(book.externalIdCandidates).toContain('id');
  }, 60_000);

  it('the reverse-inferred Draft is publishable through the normal flow', async () => {
    await prisma.ontologyDraft.deleteMany({ where: { tenantId } });
    await request(app.getHttpServer())
      .post('/reverse-inference')
      .set({ Authorization: `Bearer ${token}` })
      .send({ connectorId })
      .expect(201);

    // Preflight: all additive (new types/relationships) → safe, auto-publishable.
    const pre = await request(app.getHttpServer())
      .get('/ontology/draft/preflight')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    expect(pre.body.hasBreaking).toBe(false);

    await request(app.getHttpServer())
      .post('/ontology/draft/publish')
      .set({ Authorization: `Bearer ${token}` })
      .send({})
      .expect(200);

    const types = await prisma.objectType.findMany({ where: { tenantId } });
    expect(types.map((t) => t.name).sort()).toEqual(expect.arrayContaining(['ri_author', 'ri_book']));
  }, 60_000);
});
