#!/usr/bin/env ts-node
/**
 * Standalone end-to-end test with real LLM calls.
 * Boots app in-process, runs representative queries, validates responses.
 *
 * Usage: DEEPSEEK_API_KEY=sk-xxx npx ts-node --transpile-only scripts/test-agent-e2e-standalone.ts
 */
import { NestFactory } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '@omaha/db';
import { JwtService } from '@nestjs/jwt';

interface TestResult {
  id: string;
  query: string;
  expectation: string;
  passed: boolean;
  response: string;
  error?: string;
}

async function runAgentQuery(app: INestApplication, token: string, message: string): Promise<string> {
  const baseUrl = `http://localhost:${process.env.PORT || 3001}`;
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
          events.push(JSON.parse(json));
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
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error('❌ DEEPSEEK_API_KEY environment variable is required');
    console.log('Usage: DEEPSEEK_API_KEY=sk-xxx npm run test:e2e:agent\n');
    process.exit(1);
  }

  console.log('=== Agent E2E Test Suite (Real LLM) ===\n');
  console.log('Starting Nest application...');

  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  const port = parseInt(process.env.PORT || '3001', 10);
  await app.listen(port);

  console.log(`✓ Server listening on port ${port}\n`);

  const prisma = app.get(PrismaService);
  const jwt = app.get(JwtService);

  // Find tenant with selfBrands
  const tenants = await prisma.tenant.findMany({ take: 10 });
  const tenant = tenants.find(t => {
    const settings = t.settings as any;
    return Array.isArray(settings?.selfBrands) && settings.selfBrands.length > 0;
  }) || tenants[0];

  if (!tenant) {
    console.error('❌ No tenant found in database');
    await app.close();
    process.exit(1);
  }

  const admin = await prisma.user.findFirst({ where: { tenantId: tenant.id } });
  if (!admin) {
    console.error('❌ No user found for tenant');
    await app.close();
    process.exit(1);
  }

  const token = jwt.sign({
    userId: admin.id,
    tenantId: tenant.id,
    email: admin.email
  });

  console.log(`Tenant: ${tenant.name}`);
  console.log(`User: ${admin.email}\n`);

  const tests: Array<{ id: string; query: string; expectation: string; validate: (text: string) => boolean }> = [
    {
      id: '#200-identity',
      query: '我们在电饭煲的最新份额是多少？',
      expectation: '身份解析并报合并份额',
      validate: (text) => /\d+(\.\d+)?%/.test(text) && !/未找到|无数据|查不到/.test(text),
    },
    {
      id: '#201-priceBand-total',
      query: '小米电饭煲的总体市场份额是多少？',
      expectation: 'filter priceBand=整体',
      validate: (text) => /\d+(\.\d+)?%/.test(text),
    },
    {
      id: '#203-convergence',
      query: '电饭煲品类的主要品牌有哪些？',
      expectation: '基本查询正常收敛',
      validate: (text) => /美的|苏泊尔|九阳/.test(text),
    },
  ];

  const results: TestResult[] = [];

  for (const test of tests) {
    console.log(`\n[${test.id}] ${test.expectation}`);
    console.log(`Query: ${test.query}`);

    try {
      const response = await runAgentQuery(app, token, test.query);
      const passed = test.validate(response);

      results.push({
        id: test.id,
        query: test.query,
        expectation: test.expectation,
        passed,
        response: response.slice(0, 200),
      });

      if (passed) {
        console.log('✓ PASS');
        console.log(`Response preview: ${response.slice(0, 150)}...`);
      } else {
        console.log('✗ FAIL: validation failed');
        console.log(`Response: ${response.slice(0, 200)}...`);
      }
    } catch (err: any) {
      console.log(`✗ ERROR: ${err.message}`);
      results.push({
        id: test.id,
        query: test.query,
        expectation: test.expectation,
        passed: false,
        response: '',
        error: err.message,
      });
    }
  }

  console.log('\n=== Test Results ===');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`Passed: ${passed}/${tests.length}`);
  console.log(`Failed: ${failed}/${tests.length}`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.id}: ${r.error || 'validation failed'}`);
    });
  }

  await app.close();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
