/**
 * Delivery Report — e2e orchestration
 *
 * Ties the 5-layer engine (anchors → scenarios → postSse → judges → report) against the REAL
 * Agent endpoint with real AVC data. Produces a markdown report for 纯米 business stakeholders.
 *
 * NOT in CI — hits DeepSeek LLM. Run manually:
 *   cd apps/core-api && npx jest delivery-report/delivery-report --no-coverage --forceExit
 *
 * Prerequisites:
 *   - AVC data ingested (at least 电饭煲 single-category)
 *   - DeepSeek API key in .env (DEEPSEEK_API_KEY or system_settings)
 */
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@omaha/db';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';
import { createTestApp, postSse, runWithRetry, SseEvent, textContent } from '../test-helpers';
import { probeAnchors, Anchors } from './anchors';
import { buildScenarios, RunnableScenario, ScenarioVerdict } from './scenarios';
import { GroundTruth } from './ground-truth';
import { renderReport, ReportInput, ScenarioResult } from './report';

// ── Config ────────────────────────────────────────────────────────────────────
const N_RUNS = 2; // balance cost vs confidence (LLM non-determinism)
const SCENARIO_TIMEOUT_MS = 120_000; // per-scenario SSE timeout
const KNOWN_PASSWORD = 'delivery-report-e2e-tmp';

jest.setTimeout(2_400_000); // entire suite: N_RUNS × ~24 scenarios × ~50s each + matview refresh

// ── Suite ─────────────────────────────────────────────────────────────────────
describe('Delivery Report — full orchestration (e2e, hits real DeepSeek)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;
  let anchors: Anchors;
  let gt: GroundTruth;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaClient();
    gt = new GroundTruth(prisma);

    // 1. Probe anchors — discover tenant + data shape
    const probed = await probeAnchors(prisma);
    if (!probed) throw new Error('No AVC data found — run AVC ingest first');
    anchors = probed;

    // 2. Refresh materialized views — stale matviews cause query_objects to return empty
    const matviews = await prisma.$queryRawUnsafe<Array<{ matviewname: string }>>(
      `SELECT matviewname FROM pg_matviews WHERE matviewname LIKE 'mv_%'`,
    );
    for (const { matviewname } of matviews) {
      await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY "${matviewname}"`);
    }

    // 3. Find admin user on the probed tenant, reset password to known value
    const adminUser = await prisma.user.findFirst({
      where: { tenantId: anchors.tenantId },
      include: { role: true, tenant: true },
    });
    if (!adminUser) throw new Error(`No user found for tenant ${anchors.tenantId}`);

    const passwordHash = await bcrypt.hash(KNOWN_PASSWORD, 10);
    await prisma.user.update({
      where: { id: adminUser.id },
      data: { passwordHash },
    });

    // 4. Login with the reset password
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: adminUser.email,
        password: KNOWN_PASSWORD,
        tenantSlug: adminUser.tenant.slug,
      });
    if (loginRes.status !== 201) {
      throw new Error(`Login failed (${loginRes.status}): ${JSON.stringify(loginRes.body)}`);
    }
    token = loginRes.body.accessToken;
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  }, 30_000);

  // ── The single test: run all scenarios, produce report ────────────────────
  it('runs all scenarios N times, judges them, and writes the delivery report', async () => {
    const scenarios = buildScenarios(anchors);
    expect(scenarios.length).toBeGreaterThan(0);

    const results: ScenarioResult[] = [];

    for (const scenario of scenarios) {
      const runResults: { events: SseEvent[]; verdict: ScenarioVerdict }[] = [];
      let passes = 0;

      for (let run = 0; run < N_RUNS; run++) {
        const events = await runWithRetry(
          `${scenario.id} run-${run + 1}`,
          () => postSse(
            app,
            '/agent/chat',
            { message: scenario.question },
            token,
            SCENARIO_TIMEOUT_MS,
          ),
        );

        const verdict = await scenario.judge({ events, gt, tenantId: anchors.tenantId });
        const passed = scenarioPassed(scenario.track, verdict);
        if (passed) passes++;
        runResults.push({ events, verdict });
      }

      // Pick the best (passing) run as representative, else last run
      const representative = runResults.find((r) => scenarioPassed(scenario.track, r.verdict))
        ?? runResults[runResults.length - 1];

      results.push({
        id: scenario.id,
        category: scenario.category,
        difficulty: scenario.difficulty,
        track: scenario.track,
        question: scenario.question,
        runs: N_RUNS,
        passes,
        sampleAnswer: textContent(representative.events).slice(0, 300),
        verdict: representative.verdict,
      });

      // Progress log
      const mark = passes === N_RUNS ? '✅' : passes === 0 ? '❌' : '⚠️';
      // eslint-disable-next-line no-console
      console.log(`  ${mark} ${scenario.id} ${passes}/${N_RUNS} — ${scenario.question.slice(0, 40)}`);
    }

    // ── Render and write report ─────────────────────────────────────────────
    const leadCategory = anchors.categories[0]?.name ?? '未知';
    const report: ReportInput = {
      title: '纯米 AVC 市场智能平台 — Agent 效果验收报告',
      generatedAt: new Date().toISOString().slice(0, 10),
      tenant: '纯米科技',
      dataScope: `${leadCategory}${anchors.categories.length > 1 ? ` 等${anchors.categories.length}品类` : '单品类'} · ${anchors.categories[0]?.latestBrandPeriod ?? ''}`,
      results,
    };

    const md = renderReport(report);
    const outDir = path.resolve(__dirname, '../../reports');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `delivery-report-${report.generatedAt}.md`);
    fs.writeFileSync(outPath, md, 'utf-8');

    // eslint-disable-next-line no-console
    console.log(`\n📄 Report written to: ${outPath}`);
    console.log(`   Total: ${results.length} scenarios, ${results.reduce((a, r) => a + r.passes, 0)}/${results.reduce((a, r) => a + r.runs, 0)} passes`);

    // Minimal structural assertion — the report is the real output
    expect(md).toContain('纯米');
    expect(md).toContain('汇总');
    expect(results.length).toBeGreaterThanOrEqual(15);
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function scenarioPassed(track: 'fact' | 'behavior', verdict: ScenarioVerdict): boolean {
  if (track === 'fact') {
    return verdict.dataCorrect?.pass === true;
  }
  return verdict.behaviorCorrect?.pass === true;
}
