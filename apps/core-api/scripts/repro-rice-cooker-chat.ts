/**
 * Reproduce the 电饭煲 "近两年趋势" chat against the LIVE agent path (real DeepSeek, real tools,
 * real DB) for the 纯米 tenant, and dump the full tool-call trace + final text.
 *
 * Drives orchestrator.run() exactly as AgentController.chat() does (in-process, no HTTP/JWT) —
 * builds a CurrentUser actor from an existing tenant user, mirroring getTestTenantActor.
 *
 * The point: see whether the Agent routes "按年/同比" to aggregate_objects group by [year]
 * (ADR-0059 fix) or still hand-sums months → the 56.02 typo.
 *
 *   node -r ts-node/register -r reflect-metadata scripts/repro-rice-cooker-chat.ts <tenantSlug> ["message"]
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '@omaha/db';
import { OrchestratorService } from '../src/modules/orchestrator/orchestrator.service';
import { OntologySdk } from '../src/modules/ontology/ontology.sdk';
import type { CurrentUser } from '@omaha/shared-types';

const DEFAULT_MSG = '电饭煲近两年市场表现如何？';

async function main() {
  const tenantSlug = process.argv[2] ?? 'org-a05f8f3a';
  const message = process.argv[3] ?? DEFAULT_MSG;

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const orchestrator = await app.resolve(OrchestratorService);
  const sdk = await app.resolve(OntologySdk);

  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) { console.error(`❌ Tenant "${tenantSlug}" 不存在`); process.exit(1); }

    const u = await prisma.user.findFirst({ where: { tenantId: tenant.id }, include: { role: true } });
    if (!u) { console.error('❌ 该租户无用户'); process.exit(1); }
    const perms = ((u.role?.permissions as unknown as string[]) ?? []);
    const actor: CurrentUser = {
      id: u.id, email: u.email, name: u.name, tenantId: u.tenantId,
      roleId: u.roleId, roleName: u.role?.name ?? 'admin',
      permissions: perms, permissionRules: perms.map((p) => ({ permission: p })),
    };

    console.log(`📂 ${tenant.name} (${tenant.slug})  actor=${u.email} perms=[${perms.join(',')}]`);
    console.log(`💬 "${message}"\n${'='.repeat(70)}`);

    const [{ summary, typeNames }, tenantProfile] = await Promise.all([
      sdk.getSchemaSummary(tenant.id),
      sdk.getTenantProfile(tenant.id),
    ]);

    let textOut = '';
    let n = 0;
    for await (const ev of orchestrator.run({
      user: actor, message, schemaSummary: summary, tenantProfile, objectTypeNames: typeNames,
    })) {
      if (ev.type === 'tool_call') {
        n++;
        console.log(`\n🔧 TOOL_CALL #${n}: ${ev.name}`);
        console.log(`   args: ${JSON.stringify(ev.args)}`);
      } else if (ev.type === 'tool_result') {
        const d: any = ev.data;
        const rows = Array.isArray(d?.data) ? d.data.length : Array.isArray(d) ? d.length : '?';
        // Print a compact shape of the result so we can sanity-check the numbers.
        let preview = '';
        const arr = Array.isArray(d?.data) ? d.data : Array.isArray(d) ? d : null;
        if (arr) preview = JSON.stringify(arr.slice(0, 12));
        else preview = JSON.stringify(d).slice(0, 400);
        console.log(`   ↳ result rows=${rows}  ${preview}`);
      } else if (ev.type === 'text') {
        textOut = ev.content;
      } else if (ev.type === 'error') {
        console.log(`\n❌ ERROR: ${ev.message}`);
      }
    }

    console.log(`\n${'='.repeat(70)}\n📝 FINAL TEXT:\n${textOut}`);
    console.log(`\n${'='.repeat(70)}\n📊 tool_calls=${n}`);
  } finally {
    await app.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
