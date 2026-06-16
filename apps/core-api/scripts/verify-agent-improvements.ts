/**
 * Real-LLM regression for the #193-#197 agent-behavior improvements, against live 纯米.
 * Drives the real /agent/chat SSE endpoint and prints, per scenario, the tool-call sequence +
 * answer so the before/after can be judged. Non-deterministic; prints, does not assert.
 *
 *   node -r ts-node/register -r reflect-metadata scripts/verify-agent-improvements.ts [slug]
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
import { ValidationPipe, INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '@omaha/db';
import { AppModule } from '../src/app.module';

const SLUG = process.argv[2] ?? 'org-a05f8f3a';

async function chat(app: INestApplication, token: string, message: string, conversationId?: string, timeoutMs = 280000) {
  const server = app.getHttpServer();
  const addr: any = server.listening ? server.address() : await new Promise((r) => server.listen(0, () => r(server.address())));
  const res = await fetch(`http://127.0.0.1:${addr.port}/agent/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message, ...(conversationId ? { conversationId } : {}) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = ''; const ev: any[] = [];
  while (true) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
    const ls = buf.split('\n'); buf = ls.pop() ?? ''; for (const l of ls) if (l.startsWith('data: ')) try { ev.push(JSON.parse(l.slice(6))); } catch {} }
  return { ev, conversationId: ev.find((e) => e.conversationId)?.conversationId ?? conversationId };
}
const calls = (ev: any[]) => ev.filter((e) => e.type === 'tool_call').map((e) => {
  const a = typeof e.args === 'string' ? JSON.parse(e.args) : (e.args ?? {});
  const f = (a.filters ?? []).map((x: any) => `${x.field}${x.operator ?? '='}${JSON.stringify(x.value)}`).join(' ');
  return `${e.name}(${a.objectType ?? '—'})[${f}]`;
});
const text = (ev: any[]) => ev.filter((e) => e.type === 'text').map((e) => e.content).join('');
const confirms = (ev: any[]) => ev.filter((e) => e.type === 'confirmation_request');

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  const prisma = app.get(PrismaService); const jwt = app.get(JwtService);
  const t = await prisma.tenant.findUnique({ where: { slug: SLUG } });
  const admin = await prisma.user.findFirst({ where: { tenantId: t!.id } });
  const token = jwt.sign({ sub: admin!.id, email: admin!.email, tenantId: admin!.tenantId, roleId: admin!.roleId });
  console.log(`🔑 ${admin!.email} @ ${t!.name}\n`);

  // #196 universe — open price-band question must use brand_share, must NOT claim 400-600 真空.
  console.log('━━━ #196 universe (该攻哪个价格段) ━━━');
  {
    const { ev } = await chat(app, token, '我们（小米/米家）在电饭煲最新一期，哪个价格段最强、哪个几乎空白？该重点攻哪个段？');
    console.log('calls:', calls(ev).join('  '));
    const tx = text(ev);
    const usedBrandShare = calls(ev).some((c) => c.includes('brand_share') && c.includes('priceBand') === false ? true : c.includes('brand_share'));
    console.log('用 brand_share?', /brand_share/.test(calls(ev).join(' ')) ? '✅' : '❌',
      '| 提"真空/空白"?', /真空|空白/.test(tx) ? '⚠ 检查是否误判 400-600' : '未提真空');
    console.log('答(节选):', tx.slice(0, 500), '\n');
  }

  // #195 stop-and-confirm — a diagnostic that would drill to SKU should pause before model_metric.
  console.log('━━━ #195 停-确认 (诊断→应在钻 SKU 前停) ━━━');
  {
    const { ev } = await chat(app, token, '帮我诊断一下我们在电饭煲的竞争表现，并钻取到具体机型看看。');
    console.log('calls:', calls(ev).join('  '));
    console.log('触发 confirmation_request?', confirms(ev).length ? `✅ (${confirms(ev).length})` : '❌ 未触发');
    const drilledModel = calls(ev).some((c) => c.includes('model_metric'));
    console.log('本轮是否已自行钻到 model_metric?', drilledModel ? '⚠ 钻了(检查是否在确认后)' : '✅ 未直接钻');
    console.log('答(节选):', text(ev).slice(0, 400), '\n');
  }

  // #194 convergence — cross-category "最强/最弱品类" must converge, not spiral to timeout.
  console.log('━━━ #194 收敛 (跨品类最强/最弱) ━━━');
  {
    const start = Date.now();
    const { ev } = await chat(app, token, '我们（小米/米家）在你能查到的这些品类里，哪几个最强、哪几个最弱？');
    const secs = ((Date.now() - start) / 1000).toFixed(0);
    console.log(`calls: ${calls(ev).length} 次, 用时 ${secs}s`);
    console.log('收敛?', calls(ev).length <= 14 ? '✅ 调用受控' : `⚠ ${calls(ev).length} 次`,
      '| 出答案?', text(ev).length > 50 ? '✅' : '❌ 无答案');
    console.log('答(节选):', text(ev).slice(0, 400), '\n');
  }

  await app.close(); process.exit(0);
}
main().catch((e) => { console.error('FATAL', e?.message ?? e); process.exit(1); });
