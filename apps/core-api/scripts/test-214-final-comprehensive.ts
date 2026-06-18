#!/usr/bin/env ts-node
/**
 * FINAL COMPREHENSIVE TEST FOR #214
 * Tests all aspects with detailed logging and verification.
 */
import { PrismaClient } from '@omaha/db';
import { chatWithAgent, createToken, findTenantWithSelfBrands, getFirstUser, BASE_URL } from './test-utils';

interface TestResult {
  id: string;
  query: string;
  pass: boolean;
  response: string;
  responseLength: number;
  hasShare: boolean;
  hasError: boolean;
  duration: number;
}

async function runDetailedTest(
  token: string,
  id: string,
  query: string,
  validator: (response: string) => { pass: boolean; details: string },
): Promise<TestResult> {
  console.log(`\n[${ id }] ${query}`);
  const start = Date.now();

  const response = await chatWithAgent(token, query);
  const duration = Date.now() - start;

  const hasShare = /\d+(\.\d+)?%/.test(response);
  const hasError = /NON_ADDITIVE_SUM|不可加|错误|Error|500/.test(response);
  const validation = validator(response);

  const status = validation.pass ? '✅ PASS' : '❌ FAIL';
  console.log(`  ${status} (${duration}ms)`);
  console.log(`  ${validation.details}`);
  console.log(`  Response: ${response.slice(0, 150)}...`);

  return {
    id,
    query,
    pass: validation.pass,
    response,
    responseLength: response.length,
    hasShare,
    hasError,
    duration,
  };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  FINAL COMPREHENSIVE TEST FOR #214');
  console.log('  Phase 1: Disjoint Brand Aggregation Whitelist');
  console.log('═══════════════════════════════════════════════════════\n');

  const prisma = new PrismaClient();
  const tenant = await findTenantWithSelfBrands(prisma);
  if (!tenant) throw new Error('No tenant with selfBrands');

  const admin = await getFirstUser(prisma, tenant.id);
  if (!admin) throw new Error('No admin user');

  const token = createToken(admin.id, tenant.id, admin.email, admin.roleId);

  console.log(`Tenant: ${tenant.name} (${tenant.id})`);
  console.log(`User: ${admin.email}`);
  console.log(`API: ${BASE_URL}`);

  const results: TestResult[] = [];

  // Test 1: Core #214 functionality - cross-brand aggregation
  results.push(await runDetailedTest(
    token,
    'T1-CORE-CROSS-BRAND',
    '小米和米家在电饭煲整体市场的份额合计是多少？',
    (response) => {
      const hasShare = /\d+(\.\d+)?%/.test(response);
      const noError = !/NON_ADDITIVE_SUM|不可加/.test(response);
      const mentionsBrands = /小米/.test(response);

      return {
        pass: hasShare && noError && mentionsBrands,
        details: `Has share: ${hasShare}, No error: ${noError}, Mentions brands: ${mentionsBrands}`,
      };
    },
  ));

  // Test 2: Cross-brand with trend (S6 scenario)
  results.push(await runDetailedTest(
    token,
    'T2-S6-TREND',
    '分析小米和米家在电饭煲整体市场的份额趋势（最近3个月）',
    (response) => {
      const hasShare = /\d+(\.\d+)?%/.test(response);
      const noError = !/NON_ADDITIVE_SUM|不可加/.test(response);
      const hasTrend = /趋势|对比|变化/.test(response) || response.length > 200;

      return {
        pass: hasShare && noError && hasTrend,
        details: `Has share: ${hasShare}, No error: ${noError}, Has trend info: ${hasTrend}`,
      };
    },
  ));

  // Test 3: Cross-brand price band comparison (S7 scenario)
  results.push(await runDetailedTest(
    token,
    'T3-S7-PRICE-BAND',
    '对比小米和米家在2024年电饭煲各价格段的表现',
    (response) => {
      const hasPriceBand = /价格段|100.*元|200.*元|500.*元/.test(response);
      const noError = !/NON_ADDITIVE_SUM|不可加/.test(response);
      const hasData = response.length > 200;

      return {
        pass: hasPriceBand && noError && hasData,
        details: `Has price bands: ${hasPriceBand}, No error: ${noError}, Has data: ${hasData}`,
      };
    },
  ));

  // Test 4: Single brand baseline (no regression)
  results.push(await runDetailedTest(
    token,
    'T4-SINGLE-BRAND',
    '小米在电饭煲整体市场的份额是多少？',
    (response) => {
      const hasShare = /\d+(\.\d+)?%/.test(response);
      const noError = !/NON_ADDITIVE_SUM|不可加|错误/.test(response);

      return {
        pass: hasShare && noError,
        details: `Has share: ${hasShare}, No error: ${noError}`,
      };
    },
  ));

  // Test 5: Edge case - explicit sum request
  results.push(await runDetailedTest(
    token,
    'T5-EXPLICIT-SUM',
    '小米和米家的电饭煲份额相加是多少？',
    (response) => {
      const hasAnswer = response.length > 50;
      const noError = !/NON_ADDITIVE_SUM|不可加|500|Error/.test(response);

      return {
        pass: hasAnswer && noError,
        details: `Has answer: ${hasAnswer}, No error: ${noError}`,
      };
    },
  ));

  // Test 6: Year aggregation (Phase 1 story 4)
  results.push(await runDetailedTest(
    token,
    'T6-YEAR-AGG',
    '电饭煲2024年全年零售额是多少？',
    (response) => {
      const hasValue = /\d+(\.\d+)?(万|亿|元)/.test(response) || /零售额/.test(response);
      const mentions2024 = /2024|24年/.test(response);

      return {
        pass: hasValue && mentions2024,
        details: `Has value: ${hasValue}, Mentions 2024: ${mentions2024}`,
      };
    },
  ));

  // Summary
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════\n');

  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  const passRate = ((passed / total) * 100).toFixed(1);

  console.log(`Total Tests: ${total}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${total - passed}`);
  console.log(`Pass Rate: ${passRate}%`);
  console.log();

  console.log('Detailed Results:');
  for (const result of results) {
    const status = result.pass ? '✅' : '❌';
    console.log(`  ${status} [${result.id}] ${result.duration}ms`);
  }

  console.log('\nKey Metrics:');
  console.log(`  Average response time: ${Math.round(results.reduce((sum, r) => sum + r.duration, 0) / results.length)}ms`);
  console.log(`  Tests with share data: ${results.filter(r => r.hasShare).length}/${total}`);
  console.log(`  Tests with errors: ${results.filter(r => r.hasError).length}/${total}`);

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  FINAL RESULT: ${passed === total ? '✅ ALL TESTS PASSED' : `⚠️ ${total - passed} TESTS FAILED`}`);
  console.log('═══════════════════════════════════════════════════════\n');

  await prisma.$disconnect();
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error('\n❌ FATAL ERROR:', err);
  process.exit(1);
});
