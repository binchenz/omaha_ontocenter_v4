/**
 * Bulk-ingest the full AVC archive via the single write path (ResearchSdk.extractAvcReport).
 *
 * Reads /tmp/avc-manifest.json (written by /tmp/avc-prep.py — period, rawCategory, fileId),
 * bootstraps a standalone Nest context, resolves ResearchSdk, and ingests every staged
 * report IN TIME ORDER (22.12 → 26.04) so AVC's later restatements idempotently overwrite the
 * earlier numbers for any overlapping month. Per-file try/catch: one bad layout never aborts
 * the run. Unknown 品类 are skipped (the extractor's unjoinable-island guard throws; we log it).
 *
 * Run from apps/core-api so NestJS module resolution + decorator metadata work:
 *   node -r ts-node/register -r reflect-metadata scripts/avc-bulk-ingest.ts
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import * as fs from 'fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ResearchSdk } from '../src/modules/research/research.sdk';
import { PrismaService } from '@omaha/db';
import { normalizeCategory, type CurrentUser } from '@omaha/shared-types';

const MANIFEST = '/tmp/avc-manifest.json';
const TENANT_SLUG = 'demo';

interface ManifestEntry { period: string; rawCategory: string | null; fileId: string; source: string; }

async function main() {
  const manifest: ManifestEntry[] = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  console.log(`[bulk] ${manifest.length} staged reports from ${MANIFEST}`);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  // ResearchSdk is a plain singleton (it does not inject the REQUEST-scoped OntologyViewLoader),
  // so app.get() would also work; app.resolve() is used uniformly and remains safe.
  const sdk = await app.resolve(ResearchSdk);
  const prisma = app.get(PrismaService);

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: TENANT_SLUG } });
  // Admin actor: wildcard permission clears the data.ingest gate (seed: admin role = ['*']).
  const actor: CurrentUser = {
    id: 'bulk-script', email: 'admin@demo.com', name: 'bulk', tenantId: tenant.id,
    roleId: 'admin', roleName: 'admin', permissions: ['*'], permissionRules: [],
  };

  const skipped: ManifestEntry[] = [];
  const failed: Array<{ entry: ManifestEntry; error: string }> = [];
  let okCount = 0, metricTotal = 0, shareTotal = 0, modelTotal = 0;
  let fullCount = 0, essenceCount = 0;

  for (const e of manifest) {
    const canonical = e.rawCategory ? normalizeCategory(e.rawCategory) : null;
    if (!canonical) { skipped.push(e); console.log(`[skip] ${e.period} ${e.rawCategory ?? '?'} (无法归一)`); continue; }
    try {
      const r = await sdk.extractAvcReport(actor, { fileId: e.fileId, category: canonical });
      okCount++; metricTotal += r.metrics; shareTotal += r.brandShares; modelTotal += r.modelMetrics ?? 0;
      if (r.coverage === 'full') fullCount++; else essenceCount++;
      console.log(`[ok]   ${e.period} ${canonical.padEnd(6)} → metrics=${r.metrics} shares=${r.brandShares} models=${r.modelMetrics ?? 0} (${r.coverage})`);
    } catch (err: any) {
      failed.push({ entry: e, error: err.message });
      console.log(`[FAIL] ${e.period} ${canonical} → ${err.message}`);
    }
  }

  console.log(`\n[bulk] done. ok=${okCount} skipped=${skipped.length} failed=${failed.length}`);
  console.log(`[bulk] rows: market_metric=${metricTotal} brand_share=${shareTotal} model_metric=${modelTotal}`);
  console.log(`[bulk] coverage: full=${fullCount} essence=${essenceCount}`);
  if (skipped.length) console.log('[bulk] skipped:', skipped.map(s => `${s.period}/${s.rawCategory}`).join(', '));
  if (failed.length) console.log('[bulk] failed:', failed.map(f => `${f.entry.period}/${f.entry.rawCategory}: ${f.error}`).join(' | '));

  await app.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
