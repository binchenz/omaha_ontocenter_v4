#!/usr/bin/env ts-node
/**
 * Phase 1 #214: Test disjoint brand aggregation whitelist.
 * Validates that cross-brand SUM on brand_share.value is allowed when brands are disjoint.
 *
 * S6: "分析小米和米家在整体市场的份额趋势" → target <10 tool calls (baseline: 22)
 * S7: "对比小米和米家在 2024 年各价格段的表现" → target <12 tool calls (baseline: 18)
 */
import { PrismaClient } from '@omaha/db';
import {
  chatWithAgent,
  createToken,
  findTenantWithSelfBrands,
  getFirstUser,
  printSummary,
  runTestSuite,
  type TestCase,
} from './test-utils';

async function main() {
  console.log('=== Phase 1 #214: Disjoint Brand Aggregation Test ===\n');

  const prisma = new PrismaClient();
  const tenant = await findTenantWithSelfBrands(prisma);
  if (!tenant) throw new Error('No tenant with selfBrands');

  const admin = await getFirstUser(prisma, tenant.id);
  if (!admin) throw new Error('No admin user');

  const token = createToken(admin.id, tenant.id, admin.email, admin.roleId);
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);
  console.log(`User: ${admin.email}\n`);

  const tests: TestCase[] = [
    // S6: Cross-brand total share trend
    {
      id: 'S6-cross-brand-total-share',
      query: '分析小米和米家在整体市场电饭煲的份额趋势（最近3个月）',
      expectation: 'Tool calls <10 (baseline: 22). Should use priceBand=整体 and brand IN [小米, 米家] with SUM allowed.',
      validate: (text: string) => {
        const hasShare = /\d+(\.\d+)?%/.test(text);
        const hasBrands = /小米/.test(text) && /米家/.test(text);
        const noError = !/NON_ADDITIVE_SUM|不可加|跨维度求和/.test(text);

        return {
          pass: hasShare && hasBrands && noError,
          reason: hasShare ? '' : 'Missing share percentage',
        };
      },
    },

    // S7: Cross-brand price band comparison
    {
      id: 'S7-cross-brand-price-band',
      query: '对比小米和米家在 2024 年电饭煲各价格段的表现',
      expectation: 'Tool calls <12 (baseline: 18). Should drill into priceBands with disjoint brand aggregation.',
      validate: (text: string) => {
        const hasPriceBands = /价格段|100.*以下|500.*以上/.test(text);
        const hasBrands = /小米/.test(text) && /米家/.test(text);
        const noError = !/NON_ADDITIVE_SUM|不可加/.test(text);

        return {
          pass: hasPriceBands && hasBrands && noError,
          reason: hasPriceBands ? '' : 'Missing price band analysis',
        };
      },
    },

    // Edge case: Single brand (should still work)
    {
      id: 'S6-single-brand-baseline',
      query: '小米电饭煲整体市场份额趋势（最近3个月）',
      expectation: 'Single brand should work as before (no disjoint check needed).',
      validate: (text: string) => {
        const hasShare = /\d+(\.\d+)?%/.test(text);
        const noError = !/NON_ADDITIVE_SUM|不可加/.test(text);

        return {
          pass: hasShare && noError,
          reason: hasShare ? '' : 'Missing share percentage',
        };
      },
    },

    // Edge case: Overlapping brands (e.g., "小米" and "小米手机" if both exist)
    {
      id: 'overlap-check',
      query: '小米和小米的总份额是多少？',
      expectation: 'Duplicate brand in filter → should reject or dedupe, not error.',
      validate: (text: string) => {
        const hasShare = /\d+(\.\d+)?%/.test(text);
        const noServerError = !/Internal Server Error|500/.test(text);

        return {
          pass: hasShare && noServerError,
          reason: 'Should handle duplicate gracefully',
        };
      },
    },
  ];

  const chatFn = (query: string) => chatWithAgent(token, query);
  const results = await runTestSuite(tests, chatFn);
  printSummary(results.passed, tests.length);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
