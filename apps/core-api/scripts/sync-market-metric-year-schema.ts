/**
 * Sync the derived `year` property into the LIVE market_metric ObjectType record + refresh its
 * materialized view (ADR-0059, final hop).
 *
 * Why this is needed: ADR-0059 added `year` to the MARKET_METRIC_DEF code constant and backfilled
 * the 1593 instances, but the tenant's already-ingested ObjectType DB record was never updated.
 * get_ontology_schema / schema-summary / OntologyView.filterableFields all read the DB record, so
 * the Agent never saw `year` → never grouped by it → kept hand-summing months (the 56.02 vs 57.02
 * typo). This appends the property def so:
 *   1. get_ontology_schema exposes `year` to the Agent
 *   2. assertGroupable passes (filterableFields now includes year)
 *
 * Also refreshes the market_metric matview so the query_objects (plan) path — which reads through
 * the matview's `properties` snapshot — picks up the backfilled year. (The aggregate path reads the
 * base table directly, so it already works once the def is updated; the refresh covers query_objects.)
 *
 * Pure-additive + idempotent: only appends `year` if absent; only refreshes if the matview exists.
 * Touches NO instance data and NO brand/share values.
 *
 *   node -r ts-node/register -r reflect-metadata scripts/sync-market-metric-year-schema.ts <tenantSlug>
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '@omaha/db';
import { ViewManagerService } from '../src/modules/ontology/view-manager.service';

const YEAR_PROP = { name: 'year', label: '年份', type: 'string', filterable: true, sortable: true };

async function main() {
  const tenantSlug = process.argv[2] ?? 'org-a05f8f3a';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const viewManager = app.get(ViewManagerService);

  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) { console.error(`❌ Tenant "${tenantSlug}" 不存在`); process.exit(1); }
    console.log(`📂 ${tenant.name} (${tenant.slug})`);

    const ot = await prisma.objectType.findFirst({ where: { tenantId: tenant.id, name: 'market_metric' } });
    if (!ot) { console.error('❌ market_metric ObjectType 不存在'); process.exit(1); }

    const props = ((ot.properties ?? []) as any[]);
    if (props.some((p) => p.name === 'year')) {
      console.log('✓ ObjectType 已含 year — 跳过 schema 更新');
    } else {
      // Insert year right after month so the schema summary reads naturally.
      const monthIdx = props.findIndex((p) => p.name === 'month');
      const next = [...props];
      next.splice(monthIdx >= 0 ? monthIdx + 1 : next.length, 0, YEAR_PROP);
      await prisma.objectType.update({ where: { id: ot.id }, data: { properties: next as any } });
      console.log(`✅ 已把 year 追加进 market_metric ObjectType（${props.length} → ${next.length} 属性）`);
    }

    // Refresh the matview so query_objects (plan path) sees year in its properties snapshot.
    if (await viewManager.exists(tenant.id, 'market_metric')) {
      await viewManager.refresh(tenant.id, 'market_metric');
      console.log('✅ 已刷新 market_metric 物化视图（properties 快照纳入 year）');
    } else {
      console.log('· 无 market_metric 物化视图 — 跳过刷新');
    }

    // Verify both hops.
    const after = await prisma.objectType.findFirst({ where: { id: ot.id }, select: { properties: true } });
    const hasYear = ((after!.properties ?? []) as any[]).some((p) => p.name === 'year');
    console.log(`\n校验: ObjectType.year=${hasYear ? '✓' : '✗'}`);
  } finally {
    await app.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
