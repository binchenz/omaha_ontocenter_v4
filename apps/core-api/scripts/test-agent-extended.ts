#!/usr/bin/env ts-node
/**
 * Extended E2E test suite with more comprehensive scenarios.
 * Tests all #199-#205 fixes plus edge cases.
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
  console.log('=== Extended E2E Test Suite ===\n');

  const prisma = new PrismaClient();
  const tenant = await findTenantWithSelfBrands(prisma);
  if (!tenant) throw new Error('No tenant');

  const admin = await getFirstUser(prisma, tenant.id);
  if (!admin) throw new Error('No user');

  const token = createToken(admin.id, tenant.id, admin.email, admin.roleId);
  console.log(`Tenant: ${tenant.name}\nUser: ${admin.email}\n`);

  const tests: TestCase[] = [
    // #200 - Identity injection variations
    {
      id: '#200-first-person',
      query: '我们电饭煲份额多少？',
      expectation: '第一人称"我们"解析到 selfBrands',
      validate: (text) => ({ pass: /\d+(\.\d+)?%/.test(text) && /(小米|米家)/.test(text) }),
    },
    {
      id: '#200-tenant-name',
      query: '纯米科技电饭煲份额多少？',
      expectation: '租户名解析到 selfBrands',
      validate: (text) => ({ pass: /\d+(\.\d+)?%/.test(text) }),
    },

    // #201 - priceBand routing
    {
      id: '#201-total-share',
      query: '小米电饭煲总体份额？',
      expectation: 'filter priceBand=整体',
      validate: (text) => ({ pass: /\d+(\.\d+)?%/.test(text) && !/跨段|求和|不可加/.test(text) }),
    },
    {
      id: '#201-specific-band',
      query: '小米电饭煲 100-200 价格段份额？',
      expectation: '特定价格段查询',
      validate: (text) => ({ pass: /\d+(\.\d+)?%/.test(text) && /100.*200/.test(text) }),
    },

    // #203 - Soft budget convergence
    {
      id: '#203-simple-query',
      query: '电饭煲主要品牌？',
      expectation: '简单查询快速收敛',
      validate: (text) => ({ pass: /(美的|苏泊尔|九阳)/.test(text) && !/继续|回复/.test(text) }),
    },
    {
      id: '#203-moderate-query',
      query: '电饭煲各品牌份额排名和价格段分布？',
      expectation: '中等复杂查询收敛',
      validate: (text) => ({ pass: /\d+(\.\d+)?%/.test(text) && !/继续|回复/.test(text) }),
    },

    // #204 - Universe discipline
    {
      id: '#204-low-share',
      query: '小米在哪个价格段份额最低？',
      expectation: '低份额不说真空',
      validate: (text) => ({ pass: /价格段/.test(text) && !/真空|空白市场/.test(text) }),
    },

    // #205 - Single-value dimension annotation
    {
      id: '#205-metric-field',
      query: 'brand_share表有哪些字段？',
      expectation: 'metric字段标注为恒定值',
      validate: (text) => ({ pass: /metric/.test(text) && (/share|恒为/.test(text) || /固定/.test(text)) }),
    },

    // Edge cases
    {
      id: 'edge-nonexistent-brand',
      query: '哈哈牌电饭煲份额？',
      expectation: '不存在的品牌诚实回答',
      validate: (text) => ({ pass: /未找到|无数据|无.*记录/.test(text) || /不存在/.test(text) }),
    },
    {
      id: 'edge-cross-category',
      query: '小米在电饭煲和空气炸锅哪个品类更强？',
      expectation: '跨品类比较',
      validate: (text) => ({ pass: /(电饭煲|空气炸锅)/.test(text) && /\d+(\.\d+)?%/.test(text) }),
    },
  ];

  const { passed, failed } = await runTestSuite(tests, (query) => chatWithAgent(token, query));

  console.log('=== Extended Test Summary ===');
  printSummary(passed, tests.length);

  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
