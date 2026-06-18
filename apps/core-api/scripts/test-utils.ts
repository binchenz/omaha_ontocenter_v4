/**
 * Shared utilities for standalone test scripts (scripts/*.ts).
 * For tests that bootstrap a NestApplication, use test/test-helpers.ts instead.
 */
import { PrismaClient } from '@omaha/db';
import { sign } from 'jsonwebtoken';

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
export const BASE_URL = 'http://localhost:3001';

export interface TestCase {
  id: string;
  query: string;
  expectation: string;
  validate: (text: string) => { pass: boolean; reason?: string };
}

/**
 * Parse SSE stream and extract text content.
 * Reusable across all agent chat test scripts.
 */
export async function chatWithAgent(
  token: string,
  message: string,
  baseUrl = BASE_URL,
): Promise<string> {
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
          try {
            events.push(JSON.parse(json));
          } catch {}
        }
      }
    }
  }
  return events
    .filter((e) => e.type === 'text')
    .map((e) => e.content)
    .join('');
}

/**
 * Find the first tenant with selfBrands configured.
 * Falls back to first tenant if none have selfBrands.
 */
export async function findTenantWithSelfBrands(prisma: PrismaClient): Promise<{ id: string; slug: string; name: string; settings: any } | undefined> {
  const tenants = await prisma.tenant.findMany({ take: 10 });
  return (
    tenants.find((t) => {
      const settings = t.settings as any;
      return Array.isArray(settings?.selfBrands) && settings.selfBrands.length > 0;
    }) || tenants[0]
  );
}

/**
 * Get first user for a tenant (typically admin).
 */
export async function getFirstUser(prisma: PrismaClient, tenantId: string) {
  return prisma.user.findFirst({ where: { tenantId } });
}

/**
 * Create JWT token for a user.
 */
export function createToken(
  userId: string,
  tenantId: string,
  email: string,
  roleId: string,
  secret = JWT_SECRET,
): string {
  return sign({ sub: userId, tenantId, email, roleId }, secret);
}

/**
 * Run a test suite and return results.
 */
export async function runTestSuite(
  tests: TestCase[],
  chatFn: (query: string) => Promise<string>,
): Promise<{ passed: number; failed: number; results: Array<{ id: string; pass: boolean; reason?: string; response: string }> }> {
  const results: Array<{ id: string; pass: boolean; reason?: string; response: string }> = [];
  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    console.log(`[${test.id}] ${test.expectation}`);
    console.log(`  Query: ${test.query}`);
    try {
      const response = await chatFn(test.query);
      const result = test.validate(response);
      results.push({ id: test.id, pass: result.pass, reason: result.reason, response });

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
      results.push({ id: test.id, pass: false, reason: err.message, response: '' });
      failed++;
    }
  }

  return { passed, failed, results };
}

/**
 * Print test summary.
 */
export function printSummary(passed: number, total: number) {
  console.log('=== Summary ===');
  console.log(`Passed: ${passed}/${total}`);
  console.log(`Failed: ${total - passed}/${total}`);
  if (total > 0) {
    console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%`);
  }
}
