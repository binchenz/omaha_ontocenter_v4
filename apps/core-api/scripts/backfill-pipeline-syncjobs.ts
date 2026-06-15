import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DataPipelineOrchestrator } from '../src/modules/pipeline/data-pipeline.orchestrator';
import { PrismaService } from '@omaha/db';

/**
 * One-time backfill: enqueue a SyncJob for every successful PipelineRun whose clean Dataset
 * never got one (Phase 3 recovery).
 *
 * Why this exists: during the AVC cutover, ~92 PipelineRuns completed *before* the
 * onPipelineRunComplete wiring fix hot-reloaded, so their clean Datasets were stranded with
 * no SyncJob. This calls the same orchestrator hook the worker now calls, so it exercises the
 * real production path rather than a bespoke insert.
 *
 * Idempotent: skips runs whose outputDatasetId already has a SyncJob.
 */

async function main() {
  const tenantSlug = process.argv[2];
  if (!tenantSlug) {
    console.error('用法: node -r ts-node/register scripts/backfill-pipeline-syncjobs.ts <tenantSlug>');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const orchestrator = await app.resolve(DataPipelineOrchestrator);
  const prisma = await app.resolve(PrismaService);

  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) {
      console.error(`❌ Tenant "${tenantSlug}" 不存在`);
      process.exit(1);
    }

    const runs = await prisma.pipelineRun.findMany({
      where: { tenantId: tenant.id, status: 'success' },
      select: { id: true, outputDatasetId: true },
    });
    const syncedDatasetIds = new Set(
      (await prisma.syncJob.findMany({ where: { tenantId: tenant.id }, select: { datasetId: true } })).map(
        (s) => s.datasetId,
      ),
    );

    const stranded = runs.filter((r) => r.outputDatasetId && !syncedDatasetIds.has(r.outputDatasetId));
    console.log(`📋 ${runs.length} 成功 run，${syncedDatasetIds.size} 已有 SyncJob，${stranded.length} 待补齐\n`);

    for (let i = 0; i < stranded.length; i++) {
      const run = stranded[i];
      console.log(`[${i + 1}/${stranded.length}] run=${run.id}`);
      await orchestrator.onPipelineRunComplete(tenant.id, run.id);
      await new Promise((r) => setTimeout(r, 80));
    }

    console.log('\n✅ 补齐完成，SyncJob 已入队，workers 后台处理中');
  } catch (error: any) {
    console.error('❌ 补齐失败:', error);
    process.exit(1);
  } finally {
    await app.close();
  }
}

main();
