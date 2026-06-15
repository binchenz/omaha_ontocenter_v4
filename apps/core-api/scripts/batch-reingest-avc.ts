import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AvcConnector } from '../src/modules/research/avc-connector';
import { MarketMetricImporter } from '../src/modules/research/market-metric-importer.service';
import { readdirSync } from 'fs';
import { join } from 'path';

/**
 * 批量重灌脚本 — 将 uploads/avc-*.xlsx 通过新 Pipeline 路径重新导入（Phase 3.2）
 *
 * 新路径：AvcConnector.fetch() → 3 raw Datasets → markReady() → Pipeline → SyncJob → object_instances
 *
 * 关键点：
 * 1. 不依赖外部 manifest（老脚本的 /tmp/avc-manifest.json），直接扫描 uploads/
 * 2. 品类由文件自身的 目录 标题派生（ADR-0058），脚本不再断言品类——旧的
 *    Filename→Category（编号 % 10）映射会错标 40/50 文件，已删除
 * 3. fetch() 只产出 3 个数据星；avc_report coverage 凭证是 provenance（非 Dataset 数据，
 *    ADR-0043 §2），需在 fetch 后显式调 importReportCoverage 写入，否则 Coverage Gate 失效
 * 4. 每次 fetch 后 sleep 2s（缓解 pg-boss 队列 race）
 * 5. 结束前 30s drain（确保最后一批 Pipeline 链完成）
 *
 * 用法：
 *   node -r ts-node/register scripts/batch-reingest-avc.ts <tenantSlug>
 */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const tenantSlug = process.argv[2];
  if (!tenantSlug) {
    console.error('用法: node -r ts-node/register scripts/batch-reingest-avc.ts <tenantSlug>');
    process.exit(1);
  }

  // 1. Nest 应用上下文（复用 avc-bulk-ingest.ts 模式）
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const avcConnector = await app.resolve(AvcConnector);
  const importer = await app.resolve(MarketMetricImporter);

  try {
    // 2. 查找 Tenant
    const { PrismaService } = await import('@omaha/db');
    const prisma = await app.resolve(PrismaService);
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) {
      console.error(`❌ Tenant "${tenantSlug}" 不存在`);
      process.exit(1);
    }
    console.log(`📂 Tenant: ${tenant.name} (${tenant.id})\n`);

    // 3. 扫描 uploads/ 目录（排序确保顺序）
    const uploadsDir = join(process.cwd(), 'uploads');
    const allFiles = readdirSync(uploadsDir);
    const avcFiles = allFiles
      .filter((f) => f.startsWith('avc-') && f.endsWith('.xlsx'))
      .sort(); // 按文件名排序（22_12-00, 22_12-01, ...）

    if (avcFiles.length === 0) {
      console.error(`❌ uploads/ 目录下无 avc-*.xlsx 文件`);
      process.exit(1);
    }
    console.log(`📋 找到 ${avcFiles.length} 个 AVC 文件\n`);

    // 4. 批量导入
    let successCount = 0;
    let failCount = 0;
    for (let i = 0; i < avcFiles.length; i++) {
      const filename = avcFiles[i];
      const filePath = join(uploadsDir, filename);
      try {
        console.log(`[${i + 1}/${avcFiles.length}] ${filename}`);

        // No category asserted — the file's 目录 title is the source of truth (ADR-0058).
        const result = await avcConnector.fetch(tenant.id, { filePath });
        // Stamp the avc_report coverage provenance row (not Dataset data, ADR-0043 §2) — the
        // Coverage Gate reads it to tell "essence period, no model layer" from "real zero".
        await importer.importReportCoverage(tenant.id, {
          sourceReport: result.sourceReport,
          category: result.category,
          period: result.period,
          coverage: result.coverage,
        });
        console.log(`  ✅ ${result.category} ${result.period} — ${result.datasets.length} datasets 已入队 (${result.coverage})`);
        successCount++;

        // Race 缓解：每次 fetch 后 sleep 2s，让 Dataset → Pipeline → SyncJob 有时间跑
        if (i < avcFiles.length - 1) {
          await sleep(2000);
        }
      } catch (error: any) {
        console.error(`  ❌ 失败: ${error.message}`);
        failCount++;
        // 一个文件失败不 abort 全局，继续下一个
      }
    }

    console.log(`\n✅ 批量导入完成: ${successCount} 成功, ${failCount} 失败`);

    // 5. Drain 时间（30s，让最后一批 Pipeline 链完成）
    console.log('\n⏳ 等待 30s drain（让最后一批 Pipeline 链完成）...');
    await sleep(30000);
    console.log('✅ Drain 完成');
  } catch (error: any) {
    console.error('❌ 批量导入失败:', error);
    process.exit(1);
  } finally {
    await app.close();
  }
}

main();
