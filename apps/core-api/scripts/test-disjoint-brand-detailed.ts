#!/usr/bin/env ts-node
/**
 * Detailed test with tool call counting for Phase 1 #214 validation.
 * Measures the actual reduction in tool calls for cross-brand queries.
 */
import { PrismaClient } from '@omaha/db';
import {
  createToken,
  findTenantWithSelfBrands,
  getFirstUser,
  BASE_URL,
  JWT_SECRET,
} from './test-utils';

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

async function chatWithAgentDetailed(
  token: string,
  message: string,
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  const resp = await fetch(`${BASE_URL}/agent/chat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  if (!resp.body) throw new Error('No response body');

  let fullText = '';
  const toolCalls: ToolCall[] = [];
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (!data || data === '[DONE]') continue;

      try {
        const event = JSON.parse(data);
        if (event.type === 'text') {
          fullText += event.content;
        } else if (event.type === 'tool_call') {
          toolCalls.push({ name: event.name, args: event.args });
        }
      } catch (e) {
        // Skip malformed JSON
      }
    }
  }

  return { text: fullText, toolCalls };
}

async function main() {
  console.log('=== Phase 1 #214: Detailed Tool Call Count Test ===\n');

  const prisma = new PrismaClient();
  const tenant = await findTenantWithSelfBrands(prisma);
  if (!tenant) throw new Error('No tenant with selfBrands');

  const admin = await getFirstUser(prisma, tenant.id);
  if (!admin) throw new Error('No admin user');

  const token = createToken(admin.id, tenant.id, admin.email, admin.roleId);
  console.log(`Tenant: ${tenant.name}`);
  console.log(`User: ${admin.email}\n`);

  const tests = [
    {
      id: 'S6',
      query: '分析小米和米家在整体市场电饭煲的份额趋势（最近3个月）',
      baseline: 22,
      target: 10,
    },
    {
      id: 'S7',
      query: '对比小米和米家在 2024 年电饭煲各价格段的表现',
      baseline: 18,
      target: 12,
    },
  ];

  for (const test of tests) {
    console.log(`\n[${test.id}] ${test.query}`);
    console.log(`  Baseline: ${test.baseline} tool calls`);
    console.log(`  Target: <${test.target} tool calls`);

    const { text, toolCalls } = await chatWithAgentDetailed(token, test.query);

    console.log(`  Actual: ${toolCalls.length} tool calls`);

    const reduction = test.baseline - toolCalls.length;
    const reductionPct = ((reduction / test.baseline) * 100).toFixed(1);

    if (toolCalls.length < test.target) {
      console.log(`  ✓ PASS (${reduction} fewer calls, ${reductionPct}% reduction)`);
    } else if (toolCalls.length < test.baseline) {
      console.log(`  ⚠️ IMPROVED but not at target (${reduction} fewer calls, ${reductionPct}% reduction)`);
    } else {
      console.log(`  ✗ FAIL (no improvement)`);
    }

    console.log(`\n  Tool calls breakdown:`);
    const callCounts = toolCalls.reduce((acc, call) => {
      acc[call.name] = (acc[call.name] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    for (const [name, count] of Object.entries(callCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`    - ${name}: ${count}x`);
    }

    console.log(`\n  Response preview:`);
    console.log(`    ${text.slice(0, 200)}...`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
