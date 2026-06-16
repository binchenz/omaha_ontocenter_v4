/**
 * Sync ADR-0061 ontology semantics onto EXISTING AVC ObjectType rows.
 *
 * ensureObjectType() only CREATES — it skips a type that already exists (the
 * derived-field-downsink trap: a DEF change never reaches an already-ingested
 * tenant). The three AVC stars were ingested before ADR-0061, so their live rows
 * carry none of the new semantics:
 *   - property-level `additivity` / `ratioOf`     (#189, AdditivityGuard input)
 *   - dimensions.`collapsedDefault`               (#190, folded-dimension hints)
 *   - type-level `semantics.universe`             (#191, sampling-universe hints)
 *
 * This one-shot merges those fields from the canonical DEFs (single source of
 * truth in market-metric-importer.service.ts) onto the live rows, by property
 * name. It does NOT touch instance data or the materialized view — these are
 * schema-detail fields read at query/schema time, not stored per instance.
 * Idempotent: re-running converges to the same state.
 *
 *   node -r ts-node/register -r reflect-metadata scripts/sync-avc-semantics.ts <tenantSlug>
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '@omaha/db';
import {
  MARKET_METRIC_DEF,
  BRAND_SHARE_DEF,
  MODEL_METRIC_DEF,
} from '../src/modules/research/market-metric-importer.service';

const DEFS = [MARKET_METRIC_DEF, BRAND_SHARE_DEF, MODEL_METRIC_DEF];

async function main() {
  const tenantSlug = process.argv[2];
  if (!tenantSlug) {
    console.error('用法: node -r ts-node/register -r reflect-metadata scripts/sync-avc-semantics.ts <tenantSlug>');
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

  for (const def of DEFS) {
    const row = await prisma.objectType.findFirst({ where: { tenantId: tenant.id, name: def.name } });
    if (!row) {
      console.log(`  ⏭️  ${def.name}: 不存在，跳过（应由 ensureObjectType 首次创建）`);
      continue;
    }

    // Merge additivity/ratioOf onto live properties by name (preserve any live-only fields).
    const defPropByName = new Map(def.properties.map((p: any) => [p.name, p]));
    const liveProps = (row.properties as any[]) ?? [];
    const mergedProps = liveProps.map((lp) => {
      const dp = defPropByName.get(lp.name) as any;
      if (!dp) return lp;
      const next = { ...lp };
      if (dp.additivity !== undefined) next.additivity = dp.additivity;
      else delete next.additivity;
      if (dp.ratioOf !== undefined) next.ratioOf = dp.ratioOf;
      else delete next.ratioOf;
      return next;
    });

    // Merge dimensions (carries collapsedDefault) and type-level semantics (universe).
    const mergedDimensions = (def as any).dimensions ?? row.dimensions;
    const mergedSemantics = (def as any).semantics ?? {};

    await prisma.objectType.update({
      where: { id: row.id },
      data: {
        properties: mergedProps as any,
        dimensions: mergedDimensions as any,
        semantics: mergedSemantics as any,
        version: { increment: 1 },
      },
    });

    const tagged = mergedProps.filter((p: any) => p.additivity).map((p: any) => `${p.name}=${p.additivity}`);
    console.log(
      `  ✅ ${def.name}: additivity[${tagged.join(', ') || '—'}] ` +
        `collapsedDefault=${JSON.stringify((mergedDimensions as any)?.collapsedDefault ?? null)} ` +
        `universe=${(mergedSemantics as any)?.universe ?? '—'}`,
    );
  }

  await app.close();
  console.log('🎉 完成。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
