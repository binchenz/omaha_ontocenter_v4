/**
 * Backfill avc_report coverage provenance rows (ADR-0043 §2 / ADR-0058 follow-up).
 *
 * The batch re-ingest path (AvcConnector.fetch) emits the three data stars but NOT the avc_report
 * coverage row — that is provenance, written via importReportCoverage. This one-shot reads each
 * uploads/avc-*.xlsx, derives (category, period, coverage) from the file itself (目录 title + sheet
 * presence), and upserts the avc_report row. Idempotent: importReportCoverage upserts on
 * externalId=sourceReport, so re-running is safe and does not touch the data stars or Datasets.
 *
 *   node -r ts-node/register -r reflect-metadata scripts/backfill-avc-coverage.ts <tenantSlug>
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { readdirSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '@omaha/db';
import { AvcTemplateExtractor } from '../src/modules/research/avc-template-extractor';
import { MarketMetricImporter } from '../src/modules/research/market-metric-importer.service';

async function main() {
  const tenantSlug = process.argv[2];
  if (!tenantSlug) {
    console.error('用法: node -r ts-node/register -r reflect-metadata scripts/backfill-avc-coverage.ts <tenantSlug>');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const extractor = app.get(AvcTemplateExtractor);
  const importer = await app.resolve(MarketMetricImporter);

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) { console.error(`❌ Tenant "${tenantSlug}" 不存在`); process.exit(1); }
  console.log(`📂 Tenant: ${tenant.name} (${tenant.id})`);

  const uploadsDir = join(process.cwd(), 'uploads');
  const files = readdirSync(uploadsDir).filter((f) => f.startsWith('avc-') && f.endsWith('.xlsx')).sort();
  console.log(`📋 ${files.length} 个 AVC 文件\n`);

  let ok = 0, fail = 0;
  for (const filename of files) {
    try {
      // No asserted category — derive everything from the file (ADR-0058).
      const e = await extractor.extractAll(join(uploadsDir, filename));
      await importer.importReportCoverage(tenant.id, {
        sourceReport: e.sourceReport, category: e.category, period: e.period, coverage: e.coverage,
      });
      ok++;
      console.log(`  ✅ ${e.category} ${e.period} (${e.coverage})`);
    } catch (err: any) {
      fail++;
      console.error(`  ❌ ${filename}: ${err.message}`);
    }
  }
  console.log(`\n✅ coverage 回填完成: ${ok} 成功, ${fail} 失败`);
  await app.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
