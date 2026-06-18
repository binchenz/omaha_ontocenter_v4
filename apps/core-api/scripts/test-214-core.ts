#!/usr/bin/env ts-node
/**
 * Simple manual test to verify core #214 functionality.
 */
import { PrismaClient } from '@omaha/db';
import { chatWithAgent, createToken, findTenantWithSelfBrands, getFirstUser } from './test-utils';

async function main() {
  console.log('=== Core #214 Functionality Test ===\n');

  const prisma = new PrismaClient();
  const tenant = await findTenantWithSelfBrands(prisma);
  if (!tenant) throw new Error('No tenant');

  const admin = await getFirstUser(prisma, tenant.id);
  if (!admin) throw new Error('No user');

  const token = createToken(admin.id, tenant.id, admin.email, admin.roleId);

  console.log('Test 1: Cross-brand share (core #214 feature)');
  console.log('Query: 小米和米家在电饭煲整体市场的份额合计是多少？\n');

  const response1 = await chatWithAgent(token, '小米和米家在电饭煲整体市场的份额合计是多少？');

  console.log('Response:');
  console.log(response1.slice(0, 500));
  console.log('\n---\n');

  const hasShare = /\d+(\.\d+)?%/.test(response1);
  const noError = !/NON_ADDITIVE_SUM|不可加/.test(response1);

  console.log(`✓ Has share percentage: ${hasShare}`);
  console.log(`✓ No additivity error: ${noError}`);
  console.log(`\nResult: ${hasShare && noError ? '✅ PASS' : '❌ FAIL'}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
