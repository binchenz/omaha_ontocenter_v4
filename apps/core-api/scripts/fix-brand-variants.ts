/**
 * One-shot brand-variant correction (ADR-0058 drill-down follow-up).
 *
 * AVC source data spells some brands inconsistently (苏泊 vs 苏泊尔, 小米米家 vs 小米). The
 * Pipeline's normalize_brand step exists for this but its seeded brand_mapping is empty, and it
 * is wired only on brand_share (not model_metric) and cannot sum colliding shares. Rather than
 * rework the Pipeline now, this targeted script merges the known dirty variants into their
 * canonical brand across the already-materialized object_instances. The architectural fix is
 * tracked as a backlog issue.
 *
 * Semantics per object type:
 *  - model_metric: externalId = category_model_month (no brand) → renaming brand never collides;
 *    patch the `brand` property in place.
 *  - brand_share: externalId = category_brand_priceBand_period (contains brand) → renaming changes
 *    externalId. If the canonical externalId already exists (same brand counted twice), SUM the
 *    `value` (share) into the canonical row and delete the dirty row; otherwise rewrite externalId
 *    + brand in place.
 *  - market_metric / avc_report: no brand field, untouched.
 *
 * Idempotent: a second run finds no dirty variants and is a no-op. Wrapped in one transaction.
 *
 *   node -r ts-node/register -r reflect-metadata scripts/fix-brand-variants.ts <tenantSlug>
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '@omaha/db';
import { AvcPipelineProvisioner } from '../src/modules/pipeline/avc-pipeline-provisioner.service';

/**
 * Confirmed same-brand variants → canonical. Single source of truth is the provisioner's
 * BRAND_ALIASES (the architectural fix, #177) — this retired one-shot reuses it so the two
 * can't drift. This script is superseded by the pipeline normalize_brand path and should be
 * deleted once #177 is confirmed live on the tenant.
 */
const BRAND_VARIANTS: Record<string, string> = AvcPipelineProvisioner.BRAND_ALIASES;

async function main() {
  const tenantSlug = process.argv[2];
  if (!tenantSlug) {
    console.error('用法: node -r ts-node/register -r reflect-metadata scripts/fix-brand-variants.ts <tenantSlug>');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) { console.error(`❌ Tenant "${tenantSlug}" 不存在`); process.exit(1); }
  const tid = tenant.id;
  console.log(`📂 Tenant: ${tenant.name} (${tid})`);

  let modelPatched = 0, sharedRenamed = 0, sharedSummed = 0;

  await prisma.$transaction(async (tx: any) => {
    for (const [dirty, canon] of Object.entries(BRAND_VARIANTS)) {
      // --- model_metric: patch brand property in place (externalId unaffected) ---
      const models = await tx.objectInstance.findMany({
        where: { tenantId: tid, objectType: 'model_metric', deletedAt: null, properties: { path: ['brand'], equals: dirty } },
        select: { id: true, properties: true },
      });
      for (const m of models) {
        await tx.objectInstance.update({ where: { id: m.id }, data: { properties: { ...m.properties, brand: canon } } });
        modelPatched++;
      }

      // --- brand_share: externalId contains brand → rename or sum-on-collision ---
      const shares = await tx.objectInstance.findMany({
        where: { tenantId: tid, objectType: 'brand_share', deletedAt: null, properties: { path: ['brand'], equals: dirty } },
        select: { id: true, externalId: true, label: true, properties: true },
      });
      for (const s of shares) {
        const props = s.properties as Record<string, any>;
        const canonExt = `${props.category}_${canon}_${props.priceBand}_${props.period}`;
        const existing = await tx.objectInstance.findUnique({
          where: { tenantId_objectType_externalId: { tenantId: tid, objectType: 'brand_share', externalId: canonExt } },
          select: { id: true, properties: true },
        });
        if (existing) {
          // Same brand counted twice in this (category, priceBand, period): sum the share, drop the dirty row.
          const ep = existing.properties as Record<string, any>;
          const summed = Number(ep.value) + Number(props.value);
          await tx.objectInstance.update({ where: { id: existing.id }, data: { properties: { ...ep, value: summed } } });
          await tx.objectInstance.delete({ where: { id: s.id } });
          sharedSummed++;
        } else {
          // No collision: rewrite externalId + brand (+ label) in place.
          await tx.objectInstance.update({
            where: { id: s.id },
            data: {
              externalId: canonExt,
              label: `${props.category} ${canon} ${props.priceBand}`,
              properties: { ...props, brand: canon },
            },
          });
          sharedRenamed++;
        }
      }
    }
  }, { timeout: 30_000 });

  console.log(`✅ model_metric brand 改名: ${modelPatched} 行`);
  console.log(`✅ brand_share 直接改名: ${sharedRenamed} 行`);
  console.log(`✅ brand_share share 合并求和(删脏行): ${sharedSummed} 行`);

  await app.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
