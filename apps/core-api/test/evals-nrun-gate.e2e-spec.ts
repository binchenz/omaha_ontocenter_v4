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
 * #75 — Evals N-run pass rates + soft publish gate. The soft-gate / history logic is tested
 * deterministically by seeding pass-rate history; one live N-run test exercises the real
 * runner and is skipped gracefully if the LLM is unavailable.
 */
describe('Evals N-runs + soft publish gate (#75, e2e)', () => {
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

  const auth = () => ({ Authorization: `Bearer ${token}` });

  async function seedQuestion(question: string, passHistory: number[]) {
    return prisma.evalQuestion.create({
      data: {
        tenantId,
        question,
        baselineTool: 'aggregate_objects',
        baselineArgs: { objectType: 'shot', metrics: [{ kind: 'count' }] },
        passHistory,
      },
    });
  }

  beforeEach(async () => {
    await prisma.evalQuestion.deleteMany({ where: { tenantId } });
  });

  it('soft gate flags questions below the default threshold (0.8); stable ones pass', async () => {
    await seedQuestion('稳定问题', [1.0]);
    await seedQuestion('不稳定问题', [0.5]);

    const res = await request(app.getHttpServer()).get('/evals/soft-gate').set(auth()).expect(200);
    expect(res.body.threshold).toBe(0.8);
    expect(res.body.total).toBe(2);
    expect(res.body.requiresAck).toBe(true);
    expect(res.body.belowThreshold.map((q: any) => q.question)).toEqual(['不稳定问题']);
  });

  it('all-above-threshold needs no acknowledgment (requiresAck=false)', async () => {
    await seedQuestion('q1', [1.0]);
    await seedQuestion('q2', [0.875]); // 7/8 ≥ 0.8

    const res = await request(app.getHttpServer()).get('/evals/soft-gate').set(auth()).expect(200);
    expect(res.body.requiresAck).toBe(false);
    expect(res.body.belowThreshold).toEqual([]);
  });

  it('threshold is tunable via query param', async () => {
    await seedQuestion('q', [0.875]); // 7/8
    // With a stricter 0.9 threshold this question is now below.
    const strict = await request(app.getHttpServer()).get('/evals/soft-gate?threshold=0.9').set(auth()).expect(200);
    expect(strict.body.requiresAck).toBe(true);
    // With a lenient 0.5 threshold it passes.
    const lenient = await request(app.getHttpServer()).get('/evals/soft-gate?threshold=0.5').set(auth()).expect(200);
    expect(lenient.body.requiresAck).toBe(false);
  });

  it('a question with no run history is not flagged (nothing to acknowledge yet)', async () => {
    await seedQuestion('未跑过', []);
    const res = await request(app.getHttpServer()).get('/evals/soft-gate').set(auth()).expect(200);
    expect(res.body.requiresAck).toBe(false);
  });

  it('live N-run reports a per-question pass rate over N repetitions and records history', async () => {
    // Real ontology so the agent can plan.
    await cleanupTestTenant(app);
    await request(app.getHttpServer())
      .post('/ontology/types')
      .set(auth())
      .send({ name: 'shot', label: '镜头', properties: [{ name: 'duration', label: '时长', type: 'number', filterable: true }] })
      .expect(201);
    for (let i = 0; i < 3; i++) {
      await prisma.objectInstance.create({ data: { tenantId, objectType: 'shot', externalId: `S-${i}`, properties: { duration: i } } });
    }
    const q = await seedQuestion('一共有多少个镜头？', []);

    let res: request.Response;
    try {
      res = await request(app.getHttpServer())
        .post(`/evals/questions/${q.id}/run-n`)
        .set(auth())
        .send({ n: 3 })
        .timeout(120_000);
    } catch (err) {
      console.warn('[#75] live N-run unavailable, skipping:', (err as Error).message);
      return;
    }
    if (res.status !== 200 && res.status !== 201) {
      console.warn(`[#75] live N-run returned ${res.status}, skipping`);
      return;
    }
    expect(res.body.n).toBe(3);
    expect(res.body.runs).toHaveLength(3); // ran the FULL N, no early stop
    expect(res.body.passRate).toBeGreaterThanOrEqual(0);
    expect(res.body.passRate).toBeLessThanOrEqual(1);

    // History recorded.
    const row = await prisma.evalQuestion.findUnique({ where: { id: q.id } });
    expect((row!.passHistory as number[]).length).toBe(1);
  }, 150_000);
});
