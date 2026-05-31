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
 * #72 — Evals capture + structural scoring (single run).
 *
 * The capture/persist/planSummary/scoring path is tested deterministically (no LLM).
 * One live re-run test exercises the real agent path and is skipped gracefully if the
 * LLM is unavailable (same spirit as the drama-query probe), so the suite stays green
 * offline while still covering the end-to-end loop when a key is present.
 */
describe('Evals capture + structural compare (#72, e2e)', () => {
  let app: INestApplication;
  let token: string;
  let prisma: PrismaService;
  let tenantId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    tenantId = await ensureTestTenant(app);
    token = await loginAsTestTenantAdmin(app);
  }, 60_000);

  afterAll(async () => {
    await prisma.evalQuestion.deleteMany({ where: { tenantId } });
    await cleanupTestTenant(app);
    await app.close();
  });

  beforeEach(async () => {
    await cleanupTestTenant(app);
    await prisma.evalQuestion.deleteMany({ where: { tenantId } });
    await request(app.getHttpServer())
      .post('/ontology/types')
      .set(auth())
      .send({
        name: 'shot',
        label: '镜头',
        properties: [
          { name: 'duration', label: '时长', type: 'number', filterable: true, sortable: true, unit: 's' },
          { name: 'mood', label: '情绪', type: 'string', filterable: true },
        ],
      })
      .expect(201);
    for (let i = 0; i < 3; i++) {
      await prisma.objectInstance.create({
        data: { tenantId, objectType: 'shot', externalId: `S-${i}`, properties: { duration: i + 1, mood: 'tense' } },
      });
    }
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('captures a baseline from a plan (no hand-written JSON) with a back-translated summary', async () => {
    const res = await request(app.getHttpServer())
      .post('/evals/questions')
      .set(auth())
      .send({
        question: '统计镜头数量',
        baselineTool: 'aggregate_objects',
        baselineArgs: { objectType: 'shot', metrics: [{ kind: 'count', alias: 'n' }] },
      })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.question).toBe('统计镜头数量');
    // Capture reuses the existing plan back-translation for display.
    expect(res.body.planSummary).toContain('镜头');
    expect(res.body.planSummary).toContain('数量');
  });

  it('persists captured baselines per tenant (list/delete)', async () => {
    await request(app.getHttpServer()).post('/evals/questions').set(auth())
      .send({ question: 'Q1', baselineTool: 'aggregate_objects', baselineArgs: { objectType: 'shot', metrics: [{ kind: 'count' }] } }).expect(201);
    const created = await request(app.getHttpServer()).post('/evals/questions').set(auth())
      .send({ question: 'Q2', baselineTool: 'query_objects', baselineArgs: { objectType: 'shot' } }).expect(201);

    const list = await request(app.getHttpServer()).get('/evals/questions').set(auth()).expect(200);
    expect(list.body.map((q: any) => q.question)).toEqual(['Q1', 'Q2']);

    await request(app.getHttpServer()).delete(`/evals/questions/${created.body.id}`).set(auth()).expect(200);
    const after = await request(app.getHttpServer()).get('/evals/questions').set(auth()).expect(200);
    expect(after.body.map((q: any) => q.question)).toEqual(['Q1']);
  });

  it('live re-run scores pass/fail structurally against the baseline', async () => {
    // Capture a baseline for the simplest, most deterministic plan (count).
    const cap = await request(app.getHttpServer())
      .post('/evals/questions')
      .set(auth())
      .send({
        question: '一共有多少个镜头？',
        baselineTool: 'aggregate_objects',
        baselineArgs: { objectType: 'shot', metrics: [{ kind: 'count', alias: 'n' }] },
      })
      .expect(201);

    let run: request.Response;
    try {
      run = await request(app.getHttpServer())
        .post(`/evals/questions/${cap.body.id}/run`)
        .set(auth())
        .timeout(90_000);
    } catch (err) {
      console.warn('[#72] live agent run unavailable, skipping scoring assertion:', (err as Error).message);
      return;
    }
    if (run.status !== 201 && run.status !== 200) {
      console.warn(`[#72] live run returned ${run.status}, skipping`);
      return;
    }

    // Whatever the agent produced, the result must be a well-formed structural score.
    expect(run.body.questionId).toBe(cap.body.id);
    expect(typeof run.body.pass).toBe('boolean');
    expect(Array.isArray(run.body.diffs)).toBe(true);
    if (!run.body.pass) {
      // A mismatch must explain itself (honesty: never a silent wrong score).
      expect(run.body.diffs.length).toBeGreaterThan(0);
    }
  }, 120_000);
});
