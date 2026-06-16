#!/usr/bin/env ts-node
/**
 * E2E test using EXISTING running server (no app bootstrap).
 * Connects to localhost:3001 and runs real LLM queries.
 *
 * Prerequisites:
 *   1. Server running: DEEPSEEK_API_KEY=sk-xxx npm run start:dev
 *   2. Then run: npx ts-node --transpile-only scripts/test-agent-live-server.ts
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
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message }),
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
  }

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
          try {
            events.push(JSON.parse(json));
          } catch (e) {
            // Skip malformed JSON
          }
        }
      }
    }
  }

  return events
    .filter(e => e.type === 'text')
    .map(e => e.content)
    .join('');
}

async function main() {
  console.log('=== Live Server E2E Test ===\n');

  // Check server health
  try {
    const health = await fetch(`${baseUrl}/health`);
    if (!health.ok) throw new Error(`Health check failed: ${health.status}`);
    console.log('✓ Server is running\n');
  } catch (err: any) {
    console.error(`❌ Cannot connect to ${baseUrl}`);
    console.error(`   Make sure server is running: DEEPSEEK_API_KEY=sk-xxx npm run start:dev\n`);
    process.exit(1);
  }

  const prisma = new PrismaClient();

  // Find tenant with selfBrands
  const tenants = await prisma.tenant.findMany({ take: 10 });
  const tenant = tenants.find(t => {
    const settings = t.settings as any;
    return Array.isArray(settings?.selfBrands) && settings.selfBrands.length > 0;
  }) || tenants[0];

  if (!tenant) {
    console.error('❌ No tenant found');
    await prisma.$disconnect();
    process.exit(1);
  }

  const admin = await prisma.user.findFirst({ where: { tenantId: tenant.id } });
  if (!admin) {
    console.error('❌ No user found');
    await prisma.$disconnect();
    process.exit(1);
  }

  const token = sign(
    { userId: admin.id, tenantId: tenant.id, email: admin.email },
    JWT_SECRET
  );

  console.log(`Tenant: ${tenant.name}`);
  console.log(`User: ${admin.email}\n`);

  const tests: TestCase[] = [
    {
      id: '#200-identity',
      query: '我们在电饭煲 26.04 的份额是多少？',
      expectation: '身份解析到 selfBrands 并报合并份额',
      validate: (text) => {
        const hasPercentage = /\d+(\.\d+)?%/.test(text);
        const notMissing = !/未找到|无数据|查不到|没有.*数据/.test(text);
        return {
          pass: hasPercentage && notMissing,
          reason: !hasPercentage ? '未报份额数字' : !notMissing ? '回答说无数据' : undefined,
        };
      },
    },
    {
      id: '#201-priceBand',
      query: '小米电饭煲 26.04 的总份额是多少？',
      expectation: 'filter priceBand=整体（不跨段求和）',
      validate: (text) => {
        const hasPercentage = /\d+(\.\d+)?%/.test(text);
        const notError = !/NON_ADDITIVE_SUM|不可加|禁止/.test(text);
        return {
          pass: hasPercentage && notError,
          reason: !hasPercentage ? '未报份额' : !notError ? '触发了加性护栏' : undefined,
        };
      },
    },
    {
      id: '#203-convergence',
      query: '电饭煲 26.04 主要品牌 TOP 5 是哪些？',
      expectation: '软预算内收敛，不 punt',
      validate: (text) => {
        const hasBrands = /(美的|苏泊尔|九阳|小米)/.test(text);
        const notPunt = !/请回复.*继续|回复[""]?继续/.test(text);
        return {
          pass: hasBrands && notPunt,
          reason: !hasBrands ? '未列出品牌' : !notPunt ? '要求用户继续' : undefined,
        };
      },
    },
    {
      id: '#204-universe',
      query: '我们在电饭煲哪些价格段最弱？',
      expectation: '低份额不说"真空"',
      validate: (text) => {
        const hasPriceBands = /\d{2,4}[-~]\d{2,4}|价格段/.test(text);
        const notVacuum = !/(真空|空白|为零).*价格段|价格段.*(真空|空白|为零)/.test(text) || /份额[^真空]{0,5}低|偏弱/.test(text);
        return {
          pass: hasPriceBands && notVacuum,
          reason: !hasPriceBands ? '未提价格段' : !notVacuum ? '低份额称为真空' : undefined,
        };
      },
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    console.log(`[${test.id}] ${test.expectation}`);
    console.log(`  Query: ${test.query}`);

    try {
      const response = await chat(token, test.query);
      const result = test.validate(response);

      if (result.pass) {
        console.log('  ✓ PASS');
        console.log(`  Response: ${response.slice(0, 120)}...\n`);
        passed++;
      } else {
        console.log(`  ✗ FAIL: ${result.reason}`);
        console.log(`  Response: ${response.slice(0, 200)}...\n`);
        failed++;
      }
    } catch (err: any) {
      console.log(`  ✗ ERROR: ${err.message}\n`);
      failed++;
    }
  }

  console.log('=== Summary ===');
  console.log(`Passed: ${passed}/${tests.length}`);
  console.log(`Failed: ${failed}/${tests.length}`);

  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
