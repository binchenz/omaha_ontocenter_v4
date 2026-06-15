import { PrismaClient } from '@omaha/db';
import { writeFileSync } from 'fs';

/**
 * 快照工具 — 导出 AVC 三星数据到 JSONL，用于新旧路径 diff 对比（Phase 3.1）
 *
 * 用途：
 * 1. 重灌前导出老数据（老路径直写 object_instances）
 * 2. 重灌后导出新数据（新 Pipeline 路径）
 * 3. diff 两个快照验证正确性
 *
 * 输出格式：每行一个 JSON object，按 (objectType, externalId) 排序确保 diff 稳定
 * { objectType, externalId, label, properties }
 *
 * 用法：
 *   node -r ts-node/register scripts/snapshot-avc-data.ts <tenantSlug>
 *   输出：/tmp/avc-snapshot-YYYYMMDD-HHMMSS.jsonl
 */

const STAR_TYPES = ['market_metric', 'brand_share', 'model_metric'];

async function main() {
  const tenantSlug = process.argv[2];
  if (!tenantSlug) {
    console.error('用法: node -r ts-node/register scripts/snapshot-avc-data.ts <tenantSlug>');
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    // 1. 查找 Tenant
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) {
      console.error(`❌ Tenant "${tenantSlug}" 不存在`);
      process.exit(1);
    }
    console.log(`📂 Tenant: ${tenant.name} (${tenant.id})`);

    // 2. 查询三星数据（所有 market_metric / brand_share / model_metric）
    //    老数据路径没有 sourceRef/sourceReport 字段，直接按 objectType 过滤
    const rows = await prisma.objectInstance.findMany({
      where: {
        tenantId: tenant.id,
        objectType: { in: STAR_TYPES },
      },
      select: {
        objectType: true,
        externalId: true,
        label: true,
        properties: true,
      },
      orderBy: [{ objectType: 'asc' }, { externalId: 'asc' }],
    });

    console.log(`📊 查询到 ${rows.length} 条三星数据`);
    if (rows.length === 0) {
      console.warn('⚠️  无数据，Tenant 未导入 AVC');
    }

    // 3. 输出到 JSONL
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputPath = `/tmp/avc-snapshot-${timestamp}.jsonl`;
    const lines = rows.map((r) => JSON.stringify(r));
    writeFileSync(outputPath, lines.join('\n'), 'utf-8');

    console.log(`✅ 快照已导出: ${outputPath}`);
    console.log(`   行数: ${rows.length}`);
    console.log(`   分布: ${STAR_TYPES.map((t) => `${t}=${rows.filter((r) => r.objectType === t).length}`).join(', ')}`);
  } catch (error) {
    console.error('❌ 快照失败:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
