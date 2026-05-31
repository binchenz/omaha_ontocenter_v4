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
 * #74 — reverse-inference completion: allowedValues from distinct-value scanning (heuristic,
 * red-flagged), externalId candidates from unique indexes, and merge-on-re-run. Uses real
 * fixture tables in the dev Postgres so the actual distinct-value SQL runs.
 */
describe('Reverse-inference completion (#74, e2e)', () => {
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

    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS ri74_ticket CASCADE');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE ri74_ticket (
        id uuid PRIMARY KEY,
        code varchar(20) UNIQUE NOT NULL,
        status varchar(20) NOT NULL,
        title text
      )`);
    // status is low-cardinality (3 distinct) → allowedValues. title is high-cardinality
    // (20 distinct, above the cap) → free text, no value set. Insert 20 rows.
    const rows = Array.from({ length: 20 }, (_, i) => {
      const status = ['open', 'closed', 'pending'][i % 3];
      return `(gen_random_uuid(), 'T-${i}', '${status}', 'title text number ${i} unique')`;
    }).join(',\n');
    await prisma.$executeRawUnsafe(`INSERT INTO ri74_ticket (id, code, status, title) VALUES ${rows}`);

    const cc = app.get(ConnectorClient);
    const url = new URL(process.env.DATABASE_URL!);
    const connector = await prisma.connector.create({
      data: {
        tenantId,
        name: 'ri74-fixture',
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
    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS ri74_ticket CASCADE');
    await cleanupTestTenant(app);
    await app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('infers allowedValues for a low-cardinality string column, red-flagged for confirmation', async () => {
    await prisma.ontologyDraft.deleteMany({ where: { tenantId } });
    const res = await request(app.getHttpServer()).post('/reverse-inference').set(auth()).send({ connectorId }).expect(201);

    const ticket = res.body.snapshot.objectTypes.find((t: any) => t.name === 'ri74_ticket');
    const status = ticket.properties.find((p: any) => p.name === 'status');
    expect(status.allowedValues.sort()).toEqual(['closed', 'open', 'pending']);
    expect(status.allowedValuesUnconfirmed).toBe(true); // red flag: confirm completeness
    expect(status.provenance).toBe('heuristic');

    // Free-text column gets no value set.
    const title = ticket.properties.find((p: any) => p.name === 'title');
    expect(title.allowedValues).toBeUndefined();

    // Unique columns offered as externalId candidates.
    expect(ticket.externalIdCandidates).toEqual(expect.arrayContaining(['id', 'code']));
  }, 60_000);

  it('re-running with merge preserves OPC edits and does not overwrite the draft', async () => {
    await prisma.ontologyDraft.deleteMany({ where: { tenantId } });
    // First inference seeds the draft.
    await request(app.getHttpServer()).post('/reverse-inference').set(auth()).send({ connectorId }).expect(201);

    // OPC edits: rename the ticket label and pick the business key.
    const got = await request(app.getHttpServer()).get('/ontology/draft').set(auth()).expect(200);
    const snap = got.body.draft.snapshot;
    const ticket = snap.objectTypes.find((t: any) => t.name === 'ri74_ticket');
    ticket.label = '工单（已编辑）';
    ticket.externalId = 'code';
    await request(app.getHttpServer()).put('/ontology/draft').set(auth()).send({ snapshot: snap }).expect(200);

    // Re-run with merge → must preserve the edit.
    await request(app.getHttpServer()).post('/reverse-inference').set(auth()).send({ connectorId, merge: true }).expect(201);

    const after = await request(app.getHttpServer()).get('/ontology/draft').set(auth()).expect(200);
    const mergedTicket = after.body.draft.snapshot.objectTypes.find((t: any) => t.name === 'ri74_ticket');
    expect(mergedTicket.label).toBe('工单（已编辑）');
    expect(mergedTicket.externalId).toBe('code');
  }, 60_000);
});
