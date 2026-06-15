import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '@omaha/db';
import { PG_BOSS } from '../src/modules/dataset/pg-boss.provider';
import { SYNC_JOB_QUEUE } from '../src/modules/dataset/sync-job.service';
import PgBoss from 'pg-boss';

/**
 * Re-send existing pending SyncJob rows to the pg-boss queue (Phase 3 recovery).
 *
 * Used when a SyncJob row exists (status='pending') but its pg-boss job was orphaned
 * (worker fetched then died, leaving it 'active' forever). Re-sends the SAME syncJobId so
 * the worker reprocesses it — no duplicate SyncJob row.
 */

async function main() {
  const tenantSlug = process.argv[2];
  if (!tenantSlug) {
    console.error('用法: node -r ts-node/register scripts/requeue-sync-jobs.ts <tenantSlug>');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = await app.resolve(PrismaService);
  const boss = app.get<PgBoss>(PG_BOSS);

  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) {
      console.error(`❌ Tenant "${tenantSlug}" 不存在`);
      process.exit(1);
    }

    await boss.createQueue(SYNC_JOB_QUEUE); // idempotent

    const pending = await prisma.syncJob.findMany({
      where: { tenantId: tenant.id, status: 'pending' },
      select: { id: true },
    });
    console.log(`📋 ${pending.length} 个 pending SyncJob 待重新入队\n`);

    for (const sj of pending) {
      const jobId = await boss.send(SYNC_JOB_QUEUE, { syncJobId: sj.id });
      await prisma.syncJob.update({ where: { id: sj.id }, data: { pgBossJobId: jobId } });
      console.log(`  ✅ requeued syncJob=${sj.id} → pgBossJob=${jobId}`);
    }

    console.log('\n✅ 重新入队完成，workers 后台处理中');
  } catch (error: any) {
    console.error('❌ 重新入队失败:', error);
    process.exit(1);
  } finally {
    await app.close();
  }
}

main();
