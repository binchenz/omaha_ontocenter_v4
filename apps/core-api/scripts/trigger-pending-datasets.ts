import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DataPipelineOrchestrator } from '../src/modules/pipeline/data-pipeline.orchestrator';
import { PrismaService } from '@omaha/db';

/**
 * 手动触发所有 ready 状态的 Dataset 进入 Pipeline 链（Phase 3 修复脚本）
 *
 * 场景：Pipeline 激活前已有 150 个 ready Dataset，reactive 链错过了 markReady 事件。
 * 此脚本手动调 orchestrator.onRawDatasetReady() 补齐触发。
 */

async function main() {
  const tenantSlug = process.argv[2];
  if (!tenantSlug) {
    console.error('用法: node -r ts-node/register scripts/trigger-pending-datasets.ts <tenantSlug>');
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

    const datasets = await prisma.dataset.findMany({
      where: { tenantId: tenant.id, status: 'ready' },
      orderBy: { createdAt: 'asc' },
    });

    console.log(`📋 找到 ${datasets.length} 个 ready 状态的 Dataset\n`);

    for (let i = 0; i < datasets.length; i++) {
      const ds = datasets[i];
      console.log(`[${i + 1}/${datasets.length}] ${ds.name}`);
      await orchestrator.onRawDatasetReady(tenant.id, ds.id);
      // 小延迟避免 pg-boss 队列过载
      await new Promise((r) => setTimeout(r, 100));
    }

    console.log('\n✅ 所有 Dataset 已触发');
    console.log('⏳ pg-boss workers 将在后台处理 PipelineRun + SyncJob 队列');
  } catch (error: any) {
    console.error('❌ 触发失败:', error);
    process.exit(1);
  } finally {
    await app.close();
  }
}

main();
