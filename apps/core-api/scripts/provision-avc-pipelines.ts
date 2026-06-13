/**
 * Provision the three fixed AVC pipelines (market_metric / brand_share / model_metric)
 * per tenant, and optionally activate them (the breaking flip, ADR-0055 Steps 2+4).
 *
 * Usage:
 *   node -r ts-node/register -r reflect-metadata scripts/provision-avc-pipelines.ts [tenantSlug] [--activate]
 *
 * Without --activate: creates pipelines in `draft` (safe, live importStar untouched).
 * With --activate: additionally flips all 3 AVC pipelines to `active` — HITL step, only run
 *   after end-to-end validation upload (ADR-0055 Step 3) and after importStar has been retired.
 *
 * Idempotent: re-running is safe at any stage.
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AvcPipelineProvisioner } from '../src/modules/pipeline/avc-pipeline-provisioner.service';
import { PrismaService } from '@omaha/db';

async function main() {
  const args = process.argv.slice(2);
  const shouldActivate = args.includes('--activate');
  const slugArg = args.find((a) => !a.startsWith('--'));

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const provisioner = await app.resolve(AvcPipelineProvisioner);
  const prisma = app.get(PrismaService);

  const tenants = slugArg
    ? [await prisma.tenant.findUniqueOrThrow({ where: { slug: slugArg } })]
    : await prisma.tenant.findMany();

  console.log(`[provision] ${tenants.length} tenant(s)${slugArg ? ` (slug=${slugArg})` : ''}${shouldActivate ? ' +activate' : ''}`);

  let created = 0, skipped = 0, activated = 0;
  const failed: Array<{ tenant: string; error: string }> = [];

  for (const tenant of tenants) {
    try {
      const res = await provisioner.provision(tenant.id);
      created += res.created.length;
      skipped += res.skipped.length;
      console.log(`[ok]   ${tenant.slug.padEnd(12)} created=[${res.created.join(', ')}] skipped=[${res.skipped.join(', ')}]`);

      if (shouldActivate) {
        const act = await provisioner.activate(tenant.id);
        activated += act.activated.length;
        console.log(`[act]  ${tenant.slug.padEnd(12)} activated=[${act.activated.join(', ')}]`);
      }
    } catch (err: any) {
      failed.push({ tenant: tenant.slug, error: err.message });
      console.log(`[FAIL] ${tenant.slug.padEnd(12)} ${err.message}`);
    }
  }

  console.log(`\n[provision] done. pipelinesCreated=${created} skipped=${skipped}${shouldActivate ? ` activated=${activated}` : ''} failed=${failed.length}`);
  if (failed.length) console.log('[provision] failed:', failed.map((f) => `${f.tenant}: ${f.error}`).join(' | '));

  await app.close();
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
