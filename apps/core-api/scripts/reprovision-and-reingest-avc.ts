/**
 * #177 live cutover — re-provision the AVC pipelines to their canonical (post-#177) shape and
 * replay every uploads/avc-*.xlsx through the new DuckDB engine, so the live tenant's brand_share
 * variants merge-sum correctly and model_metric normalizes its brand.
 *
 * WHY this script (vs just re-running batch-reingest): AvcConnector.fetch() calls
 * provisioner.provision(), but provision is idempotent and SKIPS existing pipelines — so the
 * stale live pipelines (empty avc_brands config, brand_share missing concat/aggregate,
 * model_metric with zero steps) would survive a plain re-ingest. This script first DELETES the
 * three stale AVC pipelines + the empty avc_brands TransformConfig, so the next provision() (fired
 * by fetch on the first file) recreates them at the canonical version, THEN replays all files.
 *
 * DESTRUCTIVE — wipes the tenant's AVC instances + datasets + runs + the 3 pipelines. The source
 * Excel (uploads/) is the reproducible source of truth and a pre-wipe snapshot was taken. Idempotent.
 *
 * Usage:
 *   node -r ts-node/register -r reflect-metadata scripts/reprovision-and-reingest-avc.ts <tenantSlug>
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { NestFactory } from '@nestjs/core';
import { readdirSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../src/app.module';
import { PrismaService } from '@omaha/db';
import { AvcConnector } from '../src/modules/research/avc-connector';
import { MarketMetricImporter } from '../src/modules/research/market-metric-importer.service';

const AVC_TYPES = ['market_metric', 'brand_share', 'model_metric', 'avc_report'];
const AVC_PIPELINES = ['avc_market_metric', 'avc_brand_share', 'avc_model_metric'];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const tenantSlug = process.argv[2];
  if (!tenantSlug) {
    console.error('用法: ... scripts/reprovision-and-reingest-avc.ts <tenantSlug>');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const avcConnector = await app.resolve(AvcConnector);
  const importer = await app.resolve(MarketMetricImporter);

  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) {
      console.error(`❌ Tenant "${tenantSlug}" 不存在`);
      process.exit(1);
    }
    console.log(`📂 Tenant: ${tenant.name} (${tenant.id})\n`);

    // ── Phase 1: wipe instances (hard delete, see wipe-avc-instances.ts rationale) ─────────────
    const before = await prisma.objectInstance.groupBy({
      by: ['objectType'],
      where: { tenantId: tenant.id, objectType: { in: AVC_TYPES } },
      _count: { _all: true },
    });
    console.log('清除前实例:', before.map((b: any) => `${b.objectType}=${b._count._all}`).join(' ') || '(空)');
    const delInst = await prisma.objectInstance.deleteMany({
      where: { tenantId: tenant.id, objectType: { in: AVC_TYPES } },
    });
    console.log(`🗑️  硬删除 ${delInst.count} 实例`);

    // ── Phase 2: wipe AVC datasets + their FK-restricted runs/jobs ─────────────────────────────
    // Every AVC dataset — raw star snapshots (datasetPrefix avc_market/avc_brand/avc_model) and
    // their clean outputs — is `avc_`-prefixed. Clear runs/jobs first (FK-Restrict); rows cascade.
    const DS_FILTER = `name LIKE 'avc\\_%'`;
    const DS_IDS = `SELECT id FROM datasets WHERE tenant_id = $1::uuid AND ${DS_FILTER}`;
    const sj = await prisma.$executeRawUnsafe(
      `DELETE FROM sync_jobs WHERE tenant_id = $1::uuid AND dataset_id IN (${DS_IDS})`, tenant.id);
    // pipeline_run_inputs reference runs (cascade on run delete); runs reference datasets (Restrict).
    const pri = await prisma.$executeRawUnsafe(
      `DELETE FROM pipeline_run_inputs WHERE pipeline_run_id IN (
         SELECT id FROM pipeline_runs WHERE tenant_id = $1::uuid
           AND (output_dataset_id IN (${DS_IDS}) OR id IN (
             SELECT pipeline_run_id FROM pipeline_run_inputs WHERE dataset_id IN (${DS_IDS}))))`, tenant.id);
    const pr = await prisma.$executeRawUnsafe(
      `DELETE FROM pipeline_runs WHERE tenant_id = $1::uuid AND output_dataset_id IN (${DS_IDS})`, tenant.id);
    const ds = await prisma.$executeRawUnsafe(
      `DELETE FROM datasets WHERE tenant_id = $1::uuid AND ${DS_FILTER}`, tenant.id);
    console.log(`🗑️  硬删除 ${sj} SyncJob, ${pri} RunInput, ${pr} PipelineRun, ${ds} Dataset（rows 级联）`);

    // ── Phase 3: delete the 3 stale AVC pipelines + empty avc_brands config so provision() rebuilds ─
    const pipelines = await prisma.pipeline.findMany({
      where: { tenantId: tenant.id, name: { in: AVC_PIPELINES } },
    });
    for (const p of pipelines) {
      // steps + inputs cascade; runs already cleared above.
      await prisma.pipeline.delete({ where: { id: p.id } });
    }
    console.log(`🗑️  删除 ${pipelines.length} 条旧 AVC pipeline（steps/inputs 级联）`);
    const cfgDel = await prisma.$executeRawUnsafe(
      `DELETE FROM transform_configs WHERE tenant_id = $1::uuid AND name = 'avc_brands'`, tenant.id);
    console.log(`🗑️  删除 ${cfgDel} 条 avc_brands TransformConfig（将由 provision 重新播种 BRAND_ALIASES）`);

    // Delete the AVC ObjectMappings too — ensureMapping is find-or-skip, so a STALE map (built
    // before a DEF gained a property, e.g. market_metric.year per ADR-0059) would survive and the
    // SyncJob would silently drop that column on write. Deleting forces provision()'s identityMap
    // to rebuild them from the CURRENT DEFs. sync_jobs FK is SET NULL and all AVC jobs were already
    // cleared in Phase 2, so this is safe.
    const mapDel = await prisma.$executeRawUnsafe(
      `DELETE FROM object_mappings WHERE tenant_id = $1::uuid AND object_type_id IN (
         SELECT id FROM object_types WHERE tenant_id = $1::uuid
           AND name IN ('market_metric','brand_share','model_metric'))`, tenant.id);
    console.log(`🗑️  删除 ${mapDel} 条旧 AVC ObjectMapping（将由 provision 按当前 DEF 重建，修复 year 等漏列）\n`);

    // ── Phase 4: replay every uploads/avc-*.xlsx (first fetch re-provisions canonical pipelines) ─
    const uploadsDir = join(process.cwd(), 'uploads');
    const avcFiles = readdirSync(uploadsDir)
      .filter((f) => f.startsWith('avc-') && f.endsWith('.xlsx'))
      .sort();
    console.log(`📋 找到 ${avcFiles.length} 个 AVC 文件，开始重灌\n`);

    let ok = 0, fail = 0;
    for (let i = 0; i < avcFiles.length; i++) {
      const filename = avcFiles[i];
      try {
        const result = await avcConnector.fetch(tenant.id, { filePath: join(uploadsDir, filename) });
        await importer.importReportCoverage(tenant.id, {
          sourceReport: result.sourceReport,
          category: result.category,
          period: result.period,
          coverage: result.coverage,
        });
        console.log(`[${i + 1}/${avcFiles.length}] ✅ ${result.category} ${result.period} (${result.coverage})`);
        ok++;
        if (i < avcFiles.length - 1) await sleep(2000);
      } catch (error: any) {
        console.error(`[${i + 1}/${avcFiles.length}] ❌ ${filename}: ${error.message}`);
        fail++;
      }
    }
    console.log(`\n✅ 重灌入队完成: ${ok} 成功, ${fail} 失败`);

    // ── Phase 5: drain — poll the pg-boss queues until empty (a fixed sleep is too short for
    // 150 reactive pipeline→sync chains; jobs persist but the worker context closes with us). ────
    console.log('⏳ draining pipeline-run + sync-job queues...');
    const drainStart = Date.now();
    let idleRounds = 0;
    while ((Date.now() - drainStart) / 1000 < 600) {
      await sleep(3000);
      const depth: Array<{ name: string; n: number }> = await prisma.$queryRawUnsafe(
        `SELECT name, count(*)::int AS n FROM pgboss.job
           WHERE name IN ('pipeline-run','sync-job') AND state IN ('created','active','retry')
           GROUP BY name`,
      );
      const run = Number(depth.find((d) => d.name === 'pipeline-run')?.n ?? 0);
      const sync = Number(depth.find((d) => d.name === 'sync-job')?.n ?? 0);
      console.log(`   queue depth: pipeline-run=${run} sync-job=${sync}`);
      // Two consecutive empties — a completing pipeline run enqueues a sync job, so one empty read
      // can race the hand-off between queues.
      if (run === 0 && sync === 0) { if (++idleRounds >= 2) break; } else idleRounds = 0;
    }

    const after = await prisma.objectInstance.groupBy({
      by: ['objectType'],
      where: { tenantId: tenant.id, objectType: { in: AVC_TYPES } },
      _count: { _all: true },
    });
    console.log('重灌后实例:', after.map((b: any) => `${b.objectType}=${b._count._all}`).join(' ') || '(空)');
  } catch (error: any) {
    console.error('❌ 失败:', error);
    process.exit(1);
  } finally {
    await app.close();
  }
}

main();
