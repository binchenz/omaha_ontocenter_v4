#!/usr/bin/env ts-node
/**
 * Extended E2E test suite with more comprehensive scenarios.
 * Tests all #199-#205 fixes plus edge cases.
 */
import { PrismaClient } from '@omaha/db';
import { sign } from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const baseUrl = 'http://localhost:3001';

interface TestCase {
  id: string;
  query: string;
  expectation: string;
  validate: (text: string) => { pass: boolean; reason?: string };
}

async function chat(token: string, message: string): Promise<string> {
  const resp = await fetch(`${baseUrl}/agent/chat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);

  const events: any[] = [];
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.startsWith('data:')) {
        const json = line.slice(5).trim();
        if (json && json !== '[DONE]') {
          try { events.push(JSON.parse(json)); } catch {}
        }
      }
    }
  }
  return events.filter(e => e.type === 'text').map(e => e.content).join('');
}

async function main() {
  console.log('=== Extended E2E Test Suite ===\n');

  const prisma = new PrismaClient();
  const tenants = await prisma.tenant.findMany({ take: 10 });
  const tenant = tenants.find(t => {
    const settings = t.settings as any;
    return Array.isArray(settings?.selfBrands) && settings.selfBrands.length > 0;
  }) || tenants[0];

  if (!tenant) throw new Error('No tenant');
  const admin = await prisma.user.findFirst({ where: { tenantId: tenant.id } });
  if (!admin) throw new Error('No user');

  const token = sign({ sub: admin.id, tenantId: tenant.id, email: admin.email, roleId: admin.roleId }, JWT_SECRET);
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

  let passed = 0, failed = 0;

  for (const test of tests) {
    console.log(`[${test.id}] ${test.expectation}`);
    console.log(`  Query: ${test.query}`);
    try {
      const response = await chat(token, test.query);
      const result = test.validate(response);
      if (result.pass) {
        console.log('  ✓ PASS');
        console.log(`  Response: ${response.slice(0, 100)}...\n`);
        passed++;
      } else {
        console.log(`  ✗ FAIL${result.reason ? ': ' + result.reason : ''}`);
        console.log(`  Response: ${response.slice(0, 150)}...\n`);
        failed++;
      }
    } catch (err: any) {
      console.log(`  ✗ ERROR: ${err.message}\n`);
      failed++;
    }
  }

  console.log('=== Extended Test Summary ===');
  console.log(`Passed: ${passed}/${tests.length}`);
  console.log(`Failed: ${failed}/${tests.length}`);
  console.log(`Success Rate: ${((passed / tests.length) * 100).toFixed(1)}%`);

  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
