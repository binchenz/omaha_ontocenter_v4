/**
 * demo-ecommerce: setup
 *
 * Creates the demo-ecommerce tenant, admin user, ontology (5 objectTypes +
 * 4 relationships), and materialized views. Idempotent — safe to re-run.
 *
 * Usage:
 *   cd scripts && pnpm tsx demo-ecommerce/setup.ts
 *
 * Output:
 *   - tenant slug: demo-ecommerce
 *   - admin: admin@demo-ecommerce.local / (password printed to stdout on first run)
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { PrismaClient } from '@omaha/db';
import { bootstrapTenant } from '../lib/tenant-bootstrap';
import { bootstrapOntology } from '../lib/ontology-bootstrap';
import { ViewManagerService } from '../../apps/core-api/src/modules/ontology/view-manager.service';
import { ecommerceOntology } from './ontology';

const TENANT_SLUG = 'demo-ecommerce';
const ADMIN_EMAIL = 'admin@demo-ecommerce.local';
const DEFAULT_PASSWORD = 'demo2026';

async function main() {
  const prisma = new PrismaClient();

  console.log('[setup] bootstrapping tenant…');
  const tenant = await bootstrapTenant({
    prisma,
    slug: TENANT_SLUG,
    name: 'Demo E-commerce',
    adminEmail: ADMIN_EMAIL,
    generatePassword: () => DEFAULT_PASSWORD,
  });
  console.log(`[setup]   tenantId=${tenant.tenantId}`);
  if (tenant.adminCreated) {
    console.log(`[setup]   admin created: ${tenant.adminEmail} / ${tenant.initialPassword}`);
  } else {
    console.log(`[setup]   admin already exists: ${tenant.adminEmail} (password unchanged)`);
  }

  console.log('[setup] bootstrapping ontology…');
  const ont = await bootstrapOntology(prisma, tenant.tenantId, ecommerceOntology);
  console.log(`[setup]   types created=${ont.typesCreated} updated=${ont.typesUpdated}`);
  console.log(`[setup]   relationships created=${ont.relationshipsCreated}`);
  console.log(`[setup]   indexes reconciled for ${ont.indexesReconciled} types`);

  console.log('[setup] creating materialized views…');
  const viewManager = new ViewManagerService(prisma as any);
  for (const t of ecommerceOntology.objectTypes) {
    await viewManager.createOrReplace(tenant.tenantId, t.name, t.properties);
    console.log(`[setup]   mv created for ${t.name}`);
  }

  console.log(`[setup] done. tenant slug: ${TENANT_SLUG}`);
  console.log(`[setup] login: ${ADMIN_EMAIL} / ${DEFAULT_PASSWORD}`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('[setup] failed:', err);
  process.exit(1);
});
