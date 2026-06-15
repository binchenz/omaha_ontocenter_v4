/**
 * Backfill the derived `year` property on existing market_metric instances (ADR-0059).
 *
 * `year` is derived from `month` at ingest (toMarketMetricRawRow writes `year: month.slice(0,2)`)
 * so `aggregate_objects` can `group by year` deterministically and the Agent never hand-sums
 * months in a reply. Rows materialized before that change lack `year`; this script fills it.
 *
 * `year` is a pure function of the already-stored `month` (YY.MM → YY), so this reads NO source
 * Excel — just a single JSONB merge over the rows that are missing `year`.
 *
 * Idempotent: only touches rows where properties->>'year' IS NULL. A second run is a no-op.
 * Scope: market_metric ONLY (brand_share.period is already annual; model_metric stores ratios
 * whose annual sum is meaningless — see ADR-0059).
 *
 *   node -r ts-node/register -r reflect-metadata scripts/backfill-market-metric-year.ts <tenantSlug>
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '@omaha/db';

async function main() {
  const tenantSlug = process.argv[2];
  if (!tenantSlug) {
    console.error('用法: node -r ts-node/register -r reflect-metadata scripts/backfill-market-metric-year.ts <tenantSlug>');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);

  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) { console.error(`❌ Tenant "${tenantSlug}" 不存在`); process.exit(1); }
    console.log(`📂 Tenant: ${tenant.name} (${tenant.id})`);

    // year = left(month, 2). Only fill rows missing `year`; idempotent.
    const updated = await prisma.$executeRaw`
      UPDATE object_instances
      SET properties = properties || jsonb_build_object('year', left(properties->>'month', 2))
      WHERE tenant_id = ${tenant.id}::uuid
        AND object_type = 'market_metric'
        AND deleted_at IS NULL
        AND properties->>'month' IS NOT NULL
        AND properties->>'year' IS NULL
    `;
    console.log(`✅ 回填 year 完成：${updated} 行 market_metric`);

    // Verify: no market_metric row should be left without a year now.
    const [{ missing }] = await prisma.$queryRaw<{ missing: bigint }[]>`
      SELECT count(*) AS missing FROM object_instances
      WHERE tenant_id = ${tenant.id}::uuid
        AND object_type = 'market_metric'
        AND deleted_at IS NULL
        AND properties->>'year' IS NULL
    `;
    console.log(missing > 0n ? `⚠️ 仍有 ${missing} 行缺 year` : `✓ 校验通过：market_metric 全部含 year`);
  } finally {
    await app.close();
  }
}

main();
