/**
 * ADR-0058 data correction — hard-delete all AVC-derived object instances for one tenant so the
 * fixed re-ingest (category derived from the 目录 title) can replay every file as a clean insert.
 *
 * Why HARD delete, not soft: the object_instances unique constraint is (tenant, objectType,
 * externalId) WITHOUT deletedAt, and ImportEngine's upsert `update` branch does not clear
 * deletedAt. A soft-delete would leave correctly-labeled rows (unchanged externalId on re-ingest)
 * stranded as invisible. Hard delete frees every slot; the archive makes the data reproducible.
 *
 * Scope: ONLY the four AVC object types, ONLY for the named tenant. Nothing else is touched.
 *
 *   node -r ts-node/register -r reflect-metadata scripts/wipe-avc-instances.ts <tenantSlug>
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '@omaha/db';

const AVC_TYPES = ['market_metric', 'brand_share', 'model_metric', 'avc_report'];

async function main() {
  const tenantSlug = process.argv[2];
  if (!tenantSlug) {
    console.error('用法: node -r ts-node/register -r reflect-metadata scripts/wipe-avc-instances.ts <tenantSlug>');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) {
    console.error(`❌ Tenant "${tenantSlug}" 不存在`);
    process.exit(1);
  }
  console.log(`📂 Tenant: ${tenant.name} (${tenant.id})`);

  const before = await prisma.objectInstance.groupBy({
    by: ['objectType'],
    where: { tenantId: tenant.id, objectType: { in: AVC_TYPES } },
    _count: { _all: true },
  });
  console.log('清除前:', before.map((b: any) => `${b.objectType}=${b._count._all}`).join(' ') || '(空)');

  const result = await prisma.objectInstance.deleteMany({
    where: { tenantId: tenant.id, objectType: { in: AVC_TYPES } },
  });
  console.log(`🗑️  硬删除 ${result.count} 行 AVC 实例 (${AVC_TYPES.join('/')})`);

  // Also clear the AVC data-plane snapshots: the raw/clean Datasets carry a
  // (tenantId, name, version) unique key and createDataset never bumps version, so re-ingesting
  // a same-category+period file would collide. Datasets are named `avc_<star>_<category>_<period>`.
  // SyncJob.datasetId and PipelineRun.input/outputDatasetId are FK-Restrict (no cascade), so the
  // referencing rows must go first; dataset_rows DO cascade. Scope: only `avc_`-prefixed Datasets.
  const AVC_DS = `SELECT id FROM datasets WHERE tenant_id = $1::uuid AND name LIKE 'avc\\_%'`;
  const sj = await prisma.$executeRawUnsafe(
    `DELETE FROM sync_jobs WHERE tenant_id = $1::uuid AND dataset_id IN (${AVC_DS})`,
    tenant.id,
  );
  const pr = await prisma.$executeRawUnsafe(
    `DELETE FROM pipeline_runs WHERE tenant_id = $1::uuid
       AND (input_dataset_id IN (${AVC_DS}) OR output_dataset_id IN (${AVC_DS}))`,
    tenant.id,
  );
  const dsRows = await prisma.$executeRawUnsafe(
    `DELETE FROM datasets WHERE tenant_id = $1::uuid AND name LIKE 'avc\\_%'`,
    tenant.id,
  );
  console.log(`🗑️  硬删除 ${sj} SyncJob, ${pr} PipelineRun, ${dsRows} Dataset（dataset_rows 级联）`);

  await app.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
