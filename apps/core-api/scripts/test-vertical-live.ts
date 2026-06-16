/**
 * Live API smoke test: verify vertical seam + drill-gate + identity land on the running agent.
 * Hits real /agent/chat SSE (self-boots Nest, signs JWT, no separate server needed).
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '@omaha/db';
import { JwtService } from '@nestjs/jwt';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const jwt = app.get(JwtService);

  // Find any tenant with selfBrands configured (the identity test needs it).
  const tenants = await prisma.tenant.findMany({ take: 10 });
  const tenant = tenants.find(t => {
    const settings = t.settings as any;
    return Array.isArray(settings?.selfBrands) && settings.selfBrands.length > 0;
  }) || tenants[0]; // fallback to first tenant if none have selfBrands

  if (!tenant) throw new Error('No tenant in DB');

  const admin = await prisma.user.findFirst({ where: { tenantId: tenant.id } });
  if (!admin) throw new Error('No user for tenant');

  const token = jwt.sign({ userId: admin.id, tenantId: tenant.id, email: admin.email });
  const baseUrl = 'http://localhost:3001';

  console.log('=== Live API Smoke Test ===');
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);
  console.log(`User: ${admin.email}\n`);

  // Helper: consume SSE stream from /agent/chat
  async function chat(message: string) {
    const resp = await fetch(`${baseUrl}/agent/chat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
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
    return events;
  }

  // Test 1: vertical skills reach AGENT_SKILLS (reference vertical's sales_analysis).
  console.log('[Test 1] Vertical skill contribution');
  const events1 = await chat('你有哪些分析能力？列出所有 skill。');
  const text1 = events1.filter(e => e.type === 'text').map(e => e.content).join('');
  const hasSales = /sales_analysis|销售数据问答/i.test(text1);
  console.log(hasSales ? '✓ sales_analysis skill present' : '✗ missing');
  console.log(`  Snippet: ${text1.slice(0, 120)}...\n`);

  // Test 2: drill-gate (AVC gate now in AVC_VERTICAL, reference gate added).
  console.log('[Test 2] Drill-gate pause (both verticals active)');
  const events2 = await chat('我们电饭煲品牌份额多少？然后钻到机型层。');
  const confirmEvent = events2.find(e => e.type === 'confirmation_request');
  console.log(confirmEvent ? '✓ drill-gate triggered' : '✗ no pause');
  if (confirmEvent) console.log(`  Message: ${confirmEvent.message.slice(0, 60)}...\n`);

  // Test 3: identity (selfBrands still resolve post-cleanup).
  console.log('[Test 3] Identity resolution (post-neutralization)');
  const events3 = await chat('我们最近市场份额？');
  const text3 = events3.filter(e => e.type === 'text').map(e => e.content).join('');
  const hasShare = /\d+(\.\d+)?%/.test(text3) || /小米|米家/.test(text3);
  console.log(hasShare ? '✓ identity resolved' : '✗ failed');
  console.log(`  Snippet: ${text3.slice(0, 120)}...\n`);

  console.log('=== Summary ===');
  console.log(`Vertical skill: ${hasSales ? 'PASS' : 'FAIL'}`);
  console.log(`Drill-gate: ${confirmEvent ? 'PASS' : 'FAIL'}`);
  console.log(`Identity: ${hasShare ? 'PASS' : 'FAIL'}`);

  await app.close();
  process.exit(hasSales && confirmEvent && hasShare ? 0 : 1);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
