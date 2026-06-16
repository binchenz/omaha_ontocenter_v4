/**
 * Definitive live proof that AdditivityGuard (#189) fires against the REAL 纯米
 * brand_share view: SUM(value) on the non-additive share field must be rejected
 * with a NON_ADDITIVE_SUM structured error, and a weighted/ratio path must behave.
 * Exercises the actual QueryPlannerService against the live ObjectType semantics
 * synced by sync-avc-semantics.ts — no LLM, deterministic.
 *
 *   node -r ts-node/register -r reflect-metadata scripts/verify-additivity-guard-live.ts <tenantSlug>
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '@omaha/db';
import { QueryPlannerService } from '../src/modules/query/query-planner.service';

const SLUG = process.argv[2] ?? 'org-a05f8f3a';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG } });
  if (!tenant) { console.error(`tenant ${SLUG} not found`); process.exit(1); }
  // QueryPlannerService is request-scoped (its view loader is) — resolve, don't get.
  const planner = await app.resolve(QueryPlannerService);

  const checks: Array<[string, boolean, string]> = [];

  // 1. brand_share SUM(value) — must be rejected NON_ADDITIVE_SUM.
  try {
    await planner.planAggregate({
      tenantId: tenant.id, objectType: 'brand_share',
      filters: [{ field: 'category', operator: 'eq', value: '电饭煲' }, { field: 'period', operator: 'eq', value: '26.04' }],
      groupBy: ['priceBand'], metrics: [{ kind: 'sum', field: 'value', alias: 's' }],
      allowedFields: null,
    });
    checks.push(['brand_share SUM(value) rejected', false, 'NO ERROR — guard did not fire!']);
  } catch (e: any) {
    const code = e?.response?.error?.code;
    checks.push(['brand_share SUM(value) rejected as NON_ADDITIVE_SUM', code === 'NON_ADDITIVE_SUM', `code=${code} hint=${e?.response?.error?.hint?.slice(0, 60)}`]);
  }

  // 2. brand_share MAX(value) — non-additive but max is safe → must pass.
  try {
    const r = await planner.planAggregate({
      tenantId: tenant.id, objectType: 'brand_share',
      filters: [{ field: 'category', operator: 'eq', value: '电饭煲' }, { field: 'period', operator: 'eq', value: '26.04' }],
      groupBy: ['brand'], metrics: [{ kind: 'max', field: 'value', alias: 'm' }],
      allowedFields: null,
    });
    checks.push(['brand_share MAX(value) allowed', /MAX\(/i.test(r.sql), `sql ok=${/MAX\(/i.test(r.sql)}`]);
  } catch (e: any) {
    checks.push(['brand_share MAX(value) allowed', false, `unexpected reject code=${e?.response?.error?.code}`]);
  }

  // 3. model_metric AVG(avgPrice) — ratio without weight columns → RATIO_AVG_UNWEIGHTABLE.
  try {
    await planner.planAggregate({
      tenantId: tenant.id, objectType: 'model_metric',
      filters: [{ field: 'category', operator: 'eq', value: '电饭煲' }, { field: 'month', operator: 'eq', value: '25.01' }],
      groupBy: ['brand'], metrics: [{ kind: 'avg', field: 'avgPrice', alias: 'p' }],
      allowedFields: null,
    });
    checks.push(['model_metric AVG(avgPrice) rejected', false, 'NO ERROR — ratio guard did not fire!']);
  } catch (e: any) {
    const code = e?.response?.error?.code;
    checks.push(['model_metric AVG(avgPrice) rejected as RATIO_AVG_UNWEIGHTABLE', code === 'RATIO_AVG_UNWEIGHTABLE', `code=${code}`]);
  }

  // 4. market_metric SUM(value) — additive → must pass (no over-blocking).
  try {
    const r = await planner.planAggregate({
      tenantId: tenant.id, objectType: 'market_metric',
      filters: [{ field: 'category', operator: 'eq', value: '电饭煲' }, { field: 'month', operator: 'eq', value: '25.01' }, { field: 'metric', operator: 'eq', value: '零售额' }],
      groupBy: ['month'], metrics: [{ kind: 'sum', field: 'value', alias: 't' }],
      allowedFields: null,
    });
    checks.push(['market_metric SUM(value) allowed (additive not over-blocked)', /SUM\(/i.test(r.sql), `sql ok=${/SUM\(/i.test(r.sql)}`]);
  } catch (e: any) {
    checks.push(['market_metric SUM(value) allowed', false, `unexpected reject code=${e?.response?.error?.code}`]);
  }

  console.log('\n📊 AdditivityGuard live verification (real 纯米 brand_share / model_metric / market_metric):');
  for (const [name, pass, detail] of checks) console.log(`  ${pass ? '✅' : '❌'} ${name}\n       ${detail}`);
  const passed = checks.filter(([, p]) => p).length;
  console.log(`\n  ${passed}/${checks.length} guard behaviors correct.`);

  await app.close();
  process.exit(passed === checks.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
