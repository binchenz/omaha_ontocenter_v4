/**
 * demo-drama: setup
 *
 * Creates the demo-drama tenant, admin user, ontology (episode + shot),
 * and materialized views.
 *
 * Usage:
 *   cd scripts && pnpm tsx demo-drama/setup.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { PrismaClient } from '@omaha/db';
import { bootstrapTenant } from '../lib/tenant-bootstrap';
import { bootstrapOntology } from '../lib/ontology-bootstrap';
import { ViewManagerService } from '../../apps/core-api/src/modules/ontology/view-manager.service';
import { dramaOntology } from './ontology';

const TENANT_SLUG = 'demo-drama';
const TENANT_NAME = '短剧拉片分析';
const ADMIN_EMAIL = 'admin@demo-drama.local';
const ADMIN_PASSWORD = 'demo2026';

async function main() {
  const prisma = new PrismaClient();

  console.log('[setup] bootstrapping tenant…');
  const tenantResult = await bootstrapTenant({
    prisma,
    slug: TENANT_SLUG,
    name: TENANT_NAME,
    adminEmail: ADMIN_EMAIL,
    generatePassword: () => ADMIN_PASSWORD,
  });
  console.log(`[setup]   tenant: ${tenantResult.tenantSlug} (${tenantResult.tenantId})`);
  if (tenantResult.adminCreated) {
    console.log(`[setup]   admin created: ${tenantResult.adminEmail} / ${tenantResult.initialPassword}`);
  } else {
    console.log(`[setup]   admin already exists: ${tenantResult.adminEmail}`);
  }

  console.log('[setup] bootstrapping ontology…');
  const ontResult = await bootstrapOntology(prisma, tenantResult.tenantId, dramaOntology);
  console.log(`[setup]   types: ${ontResult.typesCreated} created, ${ontResult.typesUpdated} updated`);
  console.log(`[setup]   relationships: ${ontResult.relationshipsCreated} created`);
  console.log(`[setup]   indexes: ${ontResult.indexesReconciled} reconciled`);

  console.log('[setup] creating materialized views…');
  const viewManager = new ViewManagerService(prisma as any);
  for (const t of dramaOntology.objectTypes) {
    await viewManager.createOrReplace(tenantResult.tenantId, t.name, t.properties);
    console.log(`[setup]   view: mv_${t.name}`);
  }

  await prisma.$disconnect();
  console.log('[setup] done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
