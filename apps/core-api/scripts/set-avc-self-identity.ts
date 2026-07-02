/**
 * Set an AVC tenant's self-identity brands (Tenant.settings.selfBrands).
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * The runtime identity injection (ontology.sdk.ts renderSelfIdentity) reads
 * `Tenant.settings.selfBrands` and tells the Agent "本租户即『<name>』… 其产品在
 * 数据中以这些品牌出现：<selfBrands>". For an ODM tenant whose products ship under
 * OTHER brand strings (纯米科技's rice cookers appear in AVC data only as 小米 / 米家,
 * never 纯米/CHUNMI), this mapping is what lets a first-person "我们的份额" question
 * resolve to a merged 小米+米家 query instead of an empty brand=纯米 lookup.
 *
 * That value used to live ONLY as a hand-typed `UPDATE tenants SET settings...`
 * against each live DB — nothing in the provisioning path sets it, so a fresh
 * provision (new server) silently ships without identity and re-introduces the
 * "无数据/未找到纯米" failure. This script makes the value reproducible, greppable,
 * and self-validating.
 *
 * SAFETY / CORRECTNESS
 * --------------------
 * - jsonb-merges only the {selfBrands} key; every sibling settings key is preserved.
 * - VERIFIES each brand actually exists in the tenant's brand_share data before
 *   writing. This mirrors the guarantee query-planner's checkDisjointBrands needs
 *   for the #214 disjoint-brand merge: a brand string that isn't in the data can't
 *   be merged and would make the injected identity line factually wrong. A brand
 *   with zero rows aborts the write (pass --force to override, e.g. pre-ingest).
 * - Idempotent: re-running with the same brands converges to the same state.
 *
 * The company NAME (纯米科技) is recognized separately by renderSelfIdentity's
 * "或直接称呼「<name>」" clause, so do NOT list 纯米/CHUNMI here — selfBrands is the
 * set of DATA brand strings, not company aliases.
 *
 *   node -r ts-node/register -r reflect-metadata \
 *     scripts/set-avc-self-identity.ts <tenantSlug> <brand1> [brand2 ...] [--force]
 *
 * Example (纯米 prod): scripts/set-avc-self-identity.ts org-09404fda 小米 米家
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '@omaha/db';

const BRAND_SHARE_TYPE = 'brand_share';

async function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const positional = argv.filter((a) => a !== '--force');
  const tenantSlug = positional[0];
  const brands = positional.slice(1);

  if (!tenantSlug || brands.length === 0) {
    console.error(
      '用法: node -r ts-node/register -r reflect-metadata \\\n' +
        '  scripts/set-avc-self-identity.ts <tenantSlug> <brand1> [brand2 ...] [--force]',
    );
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);

  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) {
      console.error(`❌ Tenant "${tenantSlug}" 不存在`);
      process.exit(1);
    }
    console.log(`📂 Tenant: ${tenant.name} (${tenant.id})`);

    // Verify each brand exists in this tenant's brand_share data (the existence guarantee the
    // #214 disjoint-brand merge relies on; a missing brand makes the identity line a false claim).
    const counts = await prisma.$queryRawUnsafe<Array<{ brand: string; n: bigint }>>(
      `SELECT properties->>'brand' AS brand, COUNT(*) AS n
         FROM object_instances
        WHERE tenant_id = $1::uuid AND object_type = $2 AND deleted_at IS NULL
          AND properties->>'brand' = ANY($3::text[])
        GROUP BY 1`,
      tenant.id,
      BRAND_SHARE_TYPE,
      brands,
    );
    const foundByBrand = new Map(counts.map((r) => [r.brand, Number(r.n)]));
    const missing = brands.filter((b) => !foundByBrand.get(b));
    for (const b of brands) {
      const n = foundByBrand.get(b) ?? 0;
      console.log(`  ${n > 0 ? '✅' : '⚠️ '} ${b}: ${n} 行 brand_share`);
    }
    if (missing.length > 0 && !force) {
      console.error(
        `\n❌ 这些品牌在 brand_share 数据里不存在：${missing.join('、')}\n` +
          `   selfBrands 必须是数据里真实出现的品牌串（否则身份注入会声称一个不存在的品牌，重现"无数据"困惑）。\n` +
          `   请用 SELECT DISTINCT properties->>'brand' 核对真实品牌串；确需在导入前预置可加 --force。`,
      );
      process.exit(1);
    }

    // jsonb-merge only the {selfBrands} key, preserving every sibling settings key. COALESCE handles
    // a NULL settings; the create-missing flag on jsonb_set handles a settings object without the key.
    const [row] = await prisma.$queryRawUnsafe<Array<{ self_brands: unknown }>>(
      `UPDATE tenants
          SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{selfBrands}', $2::jsonb, true)
        WHERE id = $1::uuid
        RETURNING settings->'selfBrands' AS self_brands`,
      tenant.id,
      JSON.stringify(brands),
    );

    console.log(`\n🎉 selfBrands 已设置为 ${JSON.stringify(row?.self_brands)}（每请求从 DB 读，无需重启）。`);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
