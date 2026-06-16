/**
 * Focused re-verification of #178 (year-dimension trust → tool-call convergence) after the
 * strengthened skill prose. Two scenarios only, so it's fast to iterate:
 *   Y1  零售额 year rollup   — must converge in ≤ a few calls, no month-exhaustion, cites both years
 *   Y2  零售均价 year (ratio) — must use the 额÷量 two-aggregate path, not thrash on the long table
 *
 * Hits real DeepSeek. Prints a structured report (no asserts). Reuses the JWT-mint + SSE drive
 * pattern from verify-adr0061-chat.ts.
 *
 *   node -r ts-node/register -r reflect-metadata scripts/verify-year-trust-178.ts <tenantSlug>
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

interface SseEvent { type: string; [k: string]: unknown }
const TENANT_SLUG = process.argv[2] ?? 'org-a05f8f3a';

function getArgs(e: SseEvent): Record<string, unknown> {
  const raw = typeof e.arguments === 'string' ? e.arguments : typeof e.args === 'string' ? e.args : undefined;
  if (raw) { try { return JSON.parse(raw); } catch { return {}; } }
  return (e.arguments ?? e.args ?? {}) as Record<string, unknown>;
}
const textOf = (events: SseEvent[]) => events.filter((e) => e.type === 'text').map((e) => (e as any).content ?? '').join('');
const dataCalls = (events: SseEvent[]) =>
  events.filter((e) => e.type === 'tool_call').map((e) => ({ name: (e as any).name, args: getArgs(e), objectType: getArgs(e).objectType as string | undefined }));

async function postChat(app: INestApplication, token: string, message: string): Promise<SseEvent[]> {
  const server = app.getHttpServer();
  const address = server.listening ? server.address() : await new Promise<any>((r) => server.listen(0, () => r(server.address())));
  const port = typeof address === 'object' ? address.port : 0;
  const res = await fetch(`http://127.0.0.1:${port}/agent/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message }), signal: AbortSignal.timeout(180_000),
  });
  if (!res.body) return [];
  const events: SseEvent[] = [];
  const decoder = new TextDecoder();
  let buffer = '';
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) if (line.startsWith('data: ')) { try { events.push(JSON.parse(line.slice(6))); } catch {} }
  }
  return events;
}

function report(label: string, msg: string, events: SseEvent[]) {
  const calls = dataCalls(events);
  const text = textOf(events);
  const monthExhaustion = calls.filter((c) => ((c.args.filters as any[]) ?? []).some(
    (f: any) => f.field === 'month' && Array.isArray(f.value) && f.value.length >= 6)).length;
  const hitCap = events.some((e) => /最大工具调用|MAX_TOOL/.test((e as any).message ?? ''));
  console.log(`\n${'═'.repeat(78)}\n${label}  «${msg}»`);
  console.log(`  tool_calls: ${calls.length}   month-exhaustion calls: ${monthExhaustion}   hit-iteration-cap: ${hitCap}`);
  console.log(`  first call: ${calls[0] ? `${calls[0].name}(${calls[0].objectType}) groupBy:[${((calls[0].args.groupBy as any[]) ?? []).join(',')}] metric-filter:${JSON.stringify(((calls[0].args.filters as any[]) ?? []).find((f: any) => f.field === 'metric')?.value ?? '—')}` : '—'}`);
  console.log(`  answer: ${(text.slice(0, 240) || '(no text — likely hit cap)').replace(/\n/g, ' ')}`);
  const ok = calls.length <= 8 && monthExhaustion <= 1 && !hitCap && text.length > 0;
  console.log(`  ${ok ? '✅ converged efficiently with an answer' : '❌ still thrashing / no answer'}`);
  return ok;
}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  const prisma = app.get(PrismaService);
  const jwt = app.get(JwtService);
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) { console.error(`tenant ${TENANT_SLUG} not found`); process.exit(1); }
  const admin = await prisma.user.findFirst({ where: { tenantId: tenant.id } });
  const token = jwt.sign({ sub: admin!.id, email: admin!.email, tenantId: admin!.tenantId, roleId: admin!.roleId });
  console.log(`🔑 ${admin!.email} @ ${tenant.name}`);

  const y1 = report('Y1 零售额年度汇总', '电饭煲近两年（2024、2025）零售额年度对比', await postChat(app, token, '电饭煲近两年（2024、2025）的零售额年度对比如何？'));
  const y2 = report('Y2 零售均价年度（比率·两次聚合）', '电饭煲 2025 全年平均零售价', await postChat(app, token, '电饭煲 2025 全年的平均零售价大概是多少？'));

  console.log(`\n${'═'.repeat(78)}\n📊 #178 year-trust re-verify: ${[y1, y2].filter(Boolean).length}/2 converged.`);
  await app.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
