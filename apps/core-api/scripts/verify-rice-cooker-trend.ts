/**
 * One-shot ground-truth check for the 电饭煲 "近两年趋势" Agent report.
 *
 * Reads market_metric (零售额/零售量/零售均价) for 电饭煲 24.01→26.01 straight from
 * object_instances and prints the monthly table + the annual roll-ups the Agent claimed,
 * so we can diff the Agent's narrative against the data and spot any fabricated cell.
 *
 *   node -r ts-node/register -r reflect-metadata scripts/verify-rice-cooker-trend.ts <tenantSlug>
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@omaha/db';

const CATEGORY = '电饭煲';

async function main() {
  const tenantSlug = process.argv[2] ?? 'demo';
  const prisma = new PrismaClient();

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) { console.error(`❌ Tenant "${tenantSlug}" 不存在`); process.exit(1); }
  console.log(`📂 Tenant: ${tenant.name} (${tenant.id})`);

  const rows = await prisma.objectInstance.findMany({
    where: { tenantId: tenant.id, objectType: 'market_metric', deletedAt: null,
      properties: { path: ['category'], equals: CATEGORY } },
    select: { externalId: true, properties: true },
  });

  // bucket by month → metric → value
  const byMonth: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const p = r.properties as Record<string, any>;
    const m = p.month as string;
    if (!m) continue;
    (byMonth[m] ??= {})[p.metric] = Number(p.value);
  }

  const months = Object.keys(byMonth).sort();
  console.log(`\n品类=${CATEGORY}  共 ${months.length} 个月  (${months[0]} → ${months[months.length - 1]})\n`);
  console.log('月份\t零售额(万元)\t零售量(台)\t零售均价(元)');
  const inRange = months.filter((m) => m >= '24.01' && m <= '26.01');
  for (const m of inRange) {
    const b = byMonth[m];
    const amt = b['零售额'];
    const qty = b['零售量'];
    const avg = b['零售均价'];
    console.log(`${m}\t${amt ?? '—'}\t${qty ?? '—'}\t${avg ?? '—'}`);
  }

  // annual roll-ups (sum 零售额/零售量; the Agent quoted these)
  for (const yr of ['24', '25']) {
    const ms = inRange.filter((m) => m.startsWith(yr + '.'));
    const amt = ms.reduce((s, m) => s + (byMonth[m]['零售额'] ?? 0), 0);
    const qty = ms.reduce((s, m) => s + (byMonth[m]['零售量'] ?? 0), 0);
    const avgOfAvg = ms.reduce((s, m) => s + (byMonth[m]['零售均价'] ?? 0), 0) / ms.length;
    console.log(`\n20${yr} 年(${ms.length}个月): 零售额合计=${(amt / 10000).toFixed(2)}亿元  零售量合计=${(qty / 10000).toFixed(0)}万台  均价(月度算术平均)=${avgOfAvg.toFixed(1)}元`);
  }

  // is 零售均价 an independent stored star, or额/量 derived?  spot-check 3 months
  console.log('\n— 均价独立性抽查(均价 vs 零售额*10000/零售量) —');
  for (const m of ['24.01', '25.05', '26.01']) {
    const b = byMonth[m]; if (!b) continue;
    const derived = (b['零售额'] * 10000) / b['零售量'];
    console.log(`${m}: stored均价=${b['零售均价']}  vs  额/量推算=${derived.toFixed(1)}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
