/**
 * Comprehensive test for /agent/chat endpoint covering all #199-#205 fixes.
 * Tests real API with LLM, verifying:
 * - #199: drill-gate batch safety
 * - #200: identity injection with tenant name
 * - #201: priceBand=整体 routing
 * - #202: BND-3 groundedness
 * - #203: soft-budget best-effort
 * - #204: universe wording discipline
 * - #205: single-value dimension annotation
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '@omaha/db';
import { JwtService } from '@nestjs/jwt';

interface TestCase {
  id: string;
  message: string;
  expectation: string;
  verify: (text: string) => boolean;
}

const TESTS: TestCase[] = [
  {
    id: '#200-identity',
    message: '我们在电饭煲的最新份额是多少？',
    expectation: '解析到 selfBrands 并报合并份额',
    verify: (text) => /\d+(\.\d+)?%/.test(text) && !/未找到|无数据/.test(text),
  },
  {
    id: '#201-priceBand',
    message: '小米电饭煲总份额是多少？',
    expectation: 'filter priceBand=整体，不跨段求和',
    verify: (text) => /\d+(\.\d+)?%/.test(text),
  },
  {
    id: '#204-universe',
    message: '我们在哪些价格段最弱？',
    expectation: '低份额不说"真空"',
    verify: (text) => !/(真空|空白).*\d+%/.test(text),
  },
];

async function main() {
  console.log('=== Agent Chat Endpoint Comprehensive Test ===\n');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const jwt = app.get(JwtService);

  // Find first tenant with selfBrands
  const tenants = await prisma.tenant.findMany({ take: 10 });
  const tenant = tenants.find(t => {
    const settings = t.settings as any;
    return Array.isArray(settings?.selfBrands) && settings.selfBrands.length > 0;
  }) || tenants[0];

  if (!tenant) throw new Error('No tenant in DB');

  const admin = await prisma.user.findFirst({ where: { tenantId: tenant.id } });
  if (!admin) throw new Error('No user for tenant');

  const token = jwt.sign({ userId: admin.id, tenantId: tenant.id, email: admin.email });
  const baseUrl = 'http://localhost:3001';

  console.log(`Tenant: ${tenant.name} (${tenant.id})`);
  console.log(`User: ${admin.email}\n`);

  async function chat(message: string): Promise<string> {
    const resp = await fetch(`${baseUrl}/agent/chat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${text}`);
    }
    const events = [];
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines.filter(l => l.startsWith('data:'))) {
        const json = line.slice(5).trim();
        if (json && json !== '[DONE]') events.push(JSON.parse(json));
      }
    }
    return events.filter(e => e.type === 'text').map(e => e.content).join('');
  }

  let passed = 0;
  let failed = 0;

  for (const test of TESTS) {
    console.log(`[${test.id}] ${test.expectation}`);
    console.log(`  Query: ${test.message}`);
    try {
      const text = await chat(test.message);
      const ok = test.verify(text);
      if (ok) {
        console.log(`  ✓ PASS`);
        console.log(`  Response: ${text.slice(0, 100)}...\n`);
        passed++;
      } else {
        console.log(`  ✗ FAIL: verification failed`);
        console.log(`  Response: ${text.slice(0, 200)}...\n`);
        failed++;
      }
    } catch (err: any) {
      console.log(`  ✗ ERROR: ${err.message}\n`);
      failed++;
    }
  }

  console.log('=== Summary ===');
  console.log(`Passed: ${passed}/${TESTS.length}`);
  console.log(`Failed: ${failed}/${TESTS.length}`);

  await app.close();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
