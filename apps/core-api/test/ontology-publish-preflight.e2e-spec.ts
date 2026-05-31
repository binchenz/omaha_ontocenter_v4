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
 * #73 — publish preflight as an informed gate. Diff the Draft vs live ontology + instance
 * data, classify safe/breaking, count breaking-change impact, and gate: safe-only publishes
 * proceed silently; breaking changes block until explicitly confirmed. Publish never touches
 * object_instances.
 */
describe('Publish preflight informed gate (#73, e2e)', () => {
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

  const auth = () => ({ Authorization: `Bearer ${token}` });

  async function draftSnapshot() {
    const res = await request(app.getHttpServer()).get('/ontology/draft').set(auth()).expect(200);
    return res.body.draft.snapshot;
  }
  async function putDraft(snap: unknown) {
    await request(app.getHttpServer()).put('/ontology/draft').set(auth()).send({ snapshot: snap }).expect(200);
  }

  beforeEach(async () => {
    await cleanupTestTenant(app);
    await prisma.ontologyDraft.deleteMany({ where: { tenantId } });
    await request(app.getHttpServer())
      .post('/ontology/types')
      .set(auth())
      .send({
        name: 'order',
        label: '订单',
        properties: [
          { name: 'amount', label: '金额', type: 'number', filterable: true },
          { name: 'status', label: '状态', type: 'string', filterable: true, allowedValues: ['pending', 'paid', 'refunded'] },
        ],
      })
      .expect(201);
    // 3 instances: two 'paid', one 'refunded'.
    for (const [i, status] of ['paid', 'paid', 'refunded'].entries()) {
      await prisma.objectInstance.create({
        data: { tenantId, objectType: 'order', externalId: `O-${i}`, properties: { amount: 100 + i, status } },
      });
    }
  });

  it('a safe-only change (add field) auto-publishes with no confirmation', async () => {
    await request(app.getHttpServer()).post('/ontology/draft').set(auth()).expect(200);
    const snap = await draftSnapshot();
    snap.objectTypes.find((t: any) => t.name === 'order').properties.push({ name: 'note', label: '备注', type: 'string' });
    await putDraft(snap);

    const pre = await request(app.getHttpServer()).get('/ontology/draft/preflight').set(auth()).expect(200);
    expect(pre.body.hasBreaking).toBe(false);
    expect(pre.body.canAutoPublish).toBe(true);

    // No confirmation needed.
    await request(app.getHttpServer()).post('/ontology/draft/publish').set(auth()).send({}).expect(200);
  });

  it('dropping a field is breaking and reports the affected-instance impact count', async () => {
    await request(app.getHttpServer()).post('/ontology/draft').set(auth()).expect(200);
    const snap = await draftSnapshot();
    const order = snap.objectTypes.find((t: any) => t.name === 'order');
    order.properties = order.properties.filter((p: any) => p.name !== 'amount');
    await putDraft(snap);

    const pre = await request(app.getHttpServer()).get('/ontology/draft/preflight').set(auth()).expect(200);
    const drop = pre.body.changes.find((c: any) => c.kind === 'drop-field' && c.field === 'amount');
    expect(drop.tier).toBe('breaking');
    expect(drop.impactCount).toBe(3); // all 3 instances carry amount
  });

  it('tightening allowedValues scans instances and counts violations', async () => {
    await request(app.getHttpServer()).post('/ontology/draft').set(auth()).expect(200);
    const snap = await draftSnapshot();
    const order = snap.objectTypes.find((t: any) => t.name === 'order');
    // Remove 'refunded' from the legal set — the one refunded instance now violates.
    order.properties.find((p: any) => p.name === 'status').allowedValues = ['pending', 'paid'];
    await putDraft(snap);

    const pre = await request(app.getHttpServer()).get('/ontology/draft/preflight').set(auth()).expect(200);
    const restrict = pre.body.changes.find((c: any) => c.kind === 'restrict-allowed-values' && c.field === 'status');
    expect(restrict.tier).toBe('breaking');
    expect(restrict.impactCount).toBe(1);
  });

  it('a breaking publish is blocked without confirmation, and succeeds with confirmed:true', async () => {
    await request(app.getHttpServer()).post('/ontology/draft').set(auth()).expect(200);
    const snap = await draftSnapshot();
    const order = snap.objectTypes.find((t: any) => t.name === 'order');
    order.properties = order.properties.filter((p: any) => p.name !== 'amount');
    await putDraft(snap);

    // Blocked.
    const blocked = await request(app.getHttpServer()).post('/ontology/draft/publish').set(auth()).send({}).expect(400);
    expect(blocked.body.code).toBe('PUBLISH_REQUIRES_CONFIRMATION');
    // Draft still present (publish did not proceed).
    expect(await prisma.ontologyDraft.count({ where: { tenantId } })).toBe(1);

    // Confirmed → proceeds.
    await request(app.getHttpServer()).post('/ontology/draft/publish').set(auth()).send({ confirmed: true }).expect(200);
    const ot = await prisma.objectType.findFirst({ where: { tenantId, name: 'order' } });
    expect((ot!.properties as any[]).map((p) => p.name)).not.toContain('amount');
  });

  it('publish (even breaking, confirmed) never modifies object_instances', async () => {
    const before = await prisma.objectInstance.findMany({ where: { tenantId }, orderBy: { externalId: 'asc' } });

    await request(app.getHttpServer()).post('/ontology/draft').set(auth()).expect(200);
    const snap = await draftSnapshot();
    const order = snap.objectTypes.find((t: any) => t.name === 'order');
    order.properties.find((p: any) => p.name === 'status').allowedValues = ['paid']; // tightening
    await putDraft(snap);
    await request(app.getHttpServer()).post('/ontology/draft/publish').set(auth()).send({ confirmed: true }).expect(200);

    const after = await prisma.objectInstance.findMany({ where: { tenantId }, orderBy: { externalId: 'asc' } });
    expect(after.map((i) => ({ id: i.id, p: i.properties }))).toEqual(before.map((i) => ({ id: i.id, p: i.properties })));
  });
});
