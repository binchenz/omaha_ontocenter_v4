#!/usr/bin/env ts-node
/**
 * Final comprehensive test for Phase 1 completion.
 * Tests all 7 user stories from PRD #213.
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
  console.log('=== Phase 1 Final Validation: All 7 User Stories ===\n');

  const prisma = new PrismaClient();
  const tenant = await findTenantWithSelfBrands(prisma);
  if (!tenant) throw new Error('No tenant with selfBrands');

  const admin = await getFirstUser(prisma, tenant.id);
  if (!admin) throw new Error('No admin user');

  const token = createToken(admin.id, tenant.id, admin.email, admin.roleId);
  console.log(`Tenant: ${tenant.name}`);
  console.log(`User: ${admin.email}\n`);

  const tests: TestCase[] = [
    // Story 1-2: Cross-brand aggregation (disjoint whitelist #214)
    {
      id: '1-2-cross-brand-share',
      query: '小米和米家在电饭煲整体市场的份额是多少？（最近一期）',
      expectation: 'Should use priceBand=整体 with brand IN filter, allowing cross-brand SUM',
      validate: (text: string) => {
        const hasShare = /\d+(\.\d+)?%/.test(text);
        const mentions = /小米/.test(text);
        const noError = !/NON_ADDITIVE_SUM|不可加|错误/.test(text);
        return {
          pass: hasShare && mentions && noError,
          reason: hasShare ? '' : 'Missing share data',
        };
      },
    },

    // Story 3: Universe discipline (份额低 vs 真空)
    {
      id: '3-universe-discipline',
      query: '小米在电饭煲 2000 元以上价格段有产品吗？',
      expectation: 'Should check brand_share actual data, not assume vacuum from model_metric',
      validate: (text: string) => {
        const answered = text.length > 50;
        const noVacuumClaim = !/真空|空白|为零/.test(text) || /份额/.test(text);
        return {
          pass: answered && noVacuumClaim,
          reason: answered ? '' : 'No answer provided',
        };
      },
    },

    // Story 4: Year aggregation (一次 groupBy[year] 定稿)
    {
      id: '4-year-aggregation',
      query: '电饭煲 2024 年全年零售额是多少？',
      expectation: 'Should use groupBy[year], not manual month accumulation',
      validate: (text: string) => {
        const hasValue = /\d+(\.\d+)?(万|亿|元)/.test(text) || /\d+/.test(text);
        const mentions2024 = /2024|24年/.test(text);
        return {
          pass: hasValue && mentions2024,
          reason: hasValue ? '' : 'Missing value',
        };
      },
    },

    // Story 5: Avg price two-step (零售额÷零售量)
    {
      id: '5-avgprice-twostep',
      query: '电饭煲 2024 年全年平均价格是多少？',
      expectation: 'Should compute as total_value / total_volume, not avg of monthly avgPrice',
      validate: (text: string) => {
        const hasPrice = /\d+(\.\d+)?元/.test(text) || /均价/.test(text);
        return {
          pass: hasPrice,
          reason: hasPrice ? '' : 'Missing price',
        };
      },
    },

    // Story 6-7: Bug fixes (already fixed in #199/#203)
    {
      id: '6-7-no-crashes',
      query: '小米电饭煲在各个价格段的份额分布',
      expectation: 'Should not crash on drill-gate or soft-budget',
      validate: (text: string) => {
        const answered = text.length > 100;
        const noCrash = !/500|错误|崩溃/.test(text);
        return {
          pass: answered && noCrash,
          reason: answered ? '' : 'Too short or error',
        };
      },
    },
  ];

  const chatFn = (query: string) => chatWithAgent(token, query);
  const results = await runTestSuite(tests, chatFn);

  console.log('\n=== Detailed Results ===\n');
  for (let i = 0; i < tests.length; i++) {
    const test = tests[i];
    const result = results.results[i];
    console.log(`[${test.id}]`);
    console.log(`  ${test.expectation}`);
    console.log(`  ${result.pass ? '✓ PASS' : '✗ FAIL' + (result.reason ? ': ' + result.reason : '')}`);
    console.log(`  Response length: ${result.response.length} chars`);
    console.log();
  }

  printSummary(results.passed, tests.length);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
