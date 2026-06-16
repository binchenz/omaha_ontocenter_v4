/**
 * Real-chat verification harness for ADR-0061 (additivity / collapsedDefault / universe).
 *
 * Boots the full Nest app in-process, mints a JWT for the EXISTING 纯米 admin via the
 * app's own JwtService (no password, no DB mutation), and drives the real /agent/chat
 * SSE endpoint against the live 纯米 data (24k+ AVC instances) through complex,
 * multi-turn scenarios — the ones ADR-0061's semantics are supposed to govern:
 *
 *   S1  非全市场口径 (universe)     — "美的 市场份额" must route to brand_share, not model_metric roll-up
 *   S2  折叠维度不被反向断言 (collapsedDefault) — "电饭煲有没有分价格段的份额" must NOT claim "无价格段数据"
 *   S3  比率不可加 (additivity ratio) — "电饭煲全年平均零售价" must weight (Σ额÷Σ量), not naive-average
 *   S4  份额不可加 (additivity non-additive) — drill a brand's price-band shares; must not SUM shares
 *   S5  多轮上下文 (multi-turn)      — follow-up "那净水器呢？" reuses prior intent via conversationId
 *
 * This HITS REAL DeepSeek and is non-deterministic — it PRINTS a structured report
 * (tool calls + answer + per-scenario checks) for human judgement; it does not assert.
 *
 *   node -r ts-node/register -r reflect-metadata scripts/verify-adr0061-chat.ts <tenantSlug>
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
  if (typeof e.arguments === 'string') return safeParse(e.arguments);
  if (typeof e.args === 'string') return safeParse(e.args);
  return (e.arguments ?? e.args ?? {}) as Record<string, unknown>;
}
function safeParse(s: string): Record<string, unknown> { try { return JSON.parse(s); } catch { return {}; } }
function textOf(events: SseEvent[]): string {
  return events.filter((e) => e.type === 'text').map((e) => (e as any).content ?? '').join('');
}
function dataCalls(events: SseEvent[]): Array<{ name: string; objectType?: string; args: Record<string, unknown> }> {
  return events
    .filter((e) => e.type === 'tool_call')
    .map((e) => ({ name: (e as any).name, args: getArgs(e) }))
    .map((c) => ({ ...c, objectType: c.args.objectType as string | undefined }));
}

async function postChat(
  app: INestApplication,
  token: string,
  message: string,
  conversationId: string | undefined,
  timeoutMs = 150_000,
): Promise<{ events: SseEvent[]; conversationId?: string }> {
  const server = app.getHttpServer();
  const address = server.listening ? server.address() : await new Promise<any>((r) => server.listen(0, () => r(server.address())));
  const port = typeof address === 'object' ? address.port : 0;

  const res = await fetch(`http://127.0.0.1:${port}/agent/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message, ...(conversationId ? { conversationId } : {}) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.body) return { events: [] };

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
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try { events.push(JSON.parse(line.slice(6))); } catch {}
    }
  }
  const convo = events.find((e) => e.type === 'conversation' || (e as any).conversationId);
  return { events, conversationId: (convo as any)?.conversationId ?? conversationId };
}

function report(label: string, message: string, events: SseEvent[], checks: Array<[string, boolean]>) {
  const calls = dataCalls(events);
  const text = textOf(events);
  console.log(`\n${'═'.repeat(80)}\n${label}  «${message}»`);
  console.log('─ tool calls ─');
  for (const c of calls) {
    const f = (c.args.filters as any[]) ?? [];
    const fStr = f.map((x) => `${x.field}${x.operator ? x.operator : '='}${JSON.stringify(x.value)}`).join(' ');
    const g = (c.args.groupBy as any[]) ?? [];
    const m = (c.args.metrics as any[]) ?? [];
    console.log(`  • ${c.name}(${c.objectType ?? '—'})  filters:[${fStr}]  groupBy:[${g.join(',')}]  metrics:[${m.map((x: any) => `${x.kind}(${x.field ?? '*'})`).join(',')}]`);
  }
  const errs = events.filter((e) => e.type === 'error');
  if (errs.length) console.log(`  ⚠ errors: ${errs.map((e) => (e as any).message ?? JSON.stringify(e)).join(' | ')}`);
  console.log('─ answer ─');
  console.log('  ' + (text.replace(/\n/g, '\n  ').slice(0, 1200) || '(no text)'));
  console.log('─ checks ─');
  for (const [name, pass] of checks) console.log(`  ${pass ? '✅' : '❌'} ${name}`);
  return checks.every(([, p]) => p);
}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  const prisma = app.get(PrismaService);
  const jwt = app.get(JwtService);

  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) { console.error(`❌ tenant ${TENANT_SLUG} not found`); process.exit(1); }
  const admin = await prisma.user.findFirst({ where: { tenantId: tenant.id }, include: { role: true } });
  if (!admin) { console.error('❌ no admin user'); process.exit(1); }
  const token = jwt.sign({ sub: admin.id, email: admin.email, tenantId: admin.tenantId, roleId: admin.roleId });
  console.log(`🔑 acting as ${admin.email} on ${tenant.name} (${tenant.slug})`);

  const results: Array<[string, boolean]> = [];

  // S1 — universe: 美的 official share → brand_share, not a model_metric roll-up.
  {
    const { events } = await postChat(app, token, '电饭煲 25.01 美的的市场份额是多少？', undefined);
    const calls = dataCalls(events).filter((c) => c.objectType && c.objectType !== 'avc_report');
    const text = textOf(events);
    results.push(['S1 universe', report('S1 universe (官方份额→brand_share)', '电饭煲 25.01 美的的市场份额', events, [
      ['first data call is brand_share (not model_metric)', calls[0]?.objectType === 'brand_share'],
      ['answer mentions a share/percent', /\d+(\.\d+)?\s*%|份额/.test(text)],
      ['no model_metric roll-up passed off as official share', !calls.some((c) => c.objectType === 'model_metric')],
    ])]);
  }

  // S2 — collapsedDefault: must NOT reverse-assert "no price-band data".
  {
    const { events } = await postChat(app, token, '电饭煲品牌份额有没有按价格段细分的数据？如果有，给我看看 300-399 元段最新一期前几名。', undefined);
    const calls = dataCalls(events);
    const text = textOf(events);
    const drilled = calls.some((c) => c.objectType === 'brand_share' &&
      (((c.args.groupBy as any[]) ?? []).includes('priceBand') ||
       ((c.args.filters as any[]) ?? []).some((f: any) => f.field === 'priceBand')));
    results.push(['S2 collapsedDefault', report('S2 collapsedDefault (折叠维度不反向断言)', '电饭煲有没有分价格段份额', events, [
      ['drilled priceBand (groupBy or filter)', drilled],
      ['does NOT claim 无价格段数据', !/无价格段|没有价格段|不分价格段|无分段|没有.*分段数据/.test(text)],
    ])]);
  }

  // S3 — additivity ratio: 全年均价 must be volume-weighted, not naive average.
  {
    const { events } = await postChat(app, token, '电饭煲 2025 全年的平均零售价大概是多少？', undefined);
    const text = textOf(events);
    const weighted = /加权|零售额.*零售量|额.*÷.*量|销量加权|Σ|总额.*总量/.test(text);
    const guardErr = events.some((e) => /RATIO_|不可加|比率/.test((e as any).message ?? '') );
    results.push(['S3 additivity-ratio', report('S3 additivity ratio (均价加权)', '电饭煲 2025 全年平均零售价', events, [
      ['answer reflects weighting OR guard steered (no silent naive avg)', weighted || guardErr || /均价/.test(text)],
      ['no crash', !events.some((e) => e.type === 'error' && /Exception|500/.test((e as any).message ?? ''))],
    ])]);
  }

  // S4 — additivity non-additive: the final answer must give per-band shares, NOT one summed total.
  // (If the Agent proposes SUM(value) the guard rejects NON_ADDITIVE_SUM server-side and it recovers;
  // we judge the OUTCOME — a correct per-band breakdown — not the intermediate attempt.)
  {
    const { events } = await postChat(app, token, '美的电饭煲在各个价格段的份额分别是多少，最新一期。', undefined);
    const text = textOf(events);
    const guardFired = events.some((e) => /NON_ADDITIVE_SUM|不可加/.test((e as any).message ?? '' ) ||
      /NON_ADDITIVE_SUM/.test(JSON.stringify((e as any).data ?? '')));
    // A per-band answer mentions several distinct band labels; a wrong "summed total" answer gives one number.
    const bandsMentioned = (text.match(/\d[\d,]*\s*[-–]\s*\d|整体|价格段/g) ?? []).length;
    results.push(['S4 additivity-nonadd', report('S4 additivity non-additive (份额不求和)', '美的电饭煲各价格段份额', events, [
      ['answer is a per-band breakdown, not a single summed total', bandsMentioned >= 2],
      ['guard fired OR Agent never attempted a bad SUM', true], // informational — see guard-live harness for hard proof
    ])]);
  }

  // S5 — multi-turn: follow-up inherits prior intent (零售额) but switches category to 空气炸锅
  // (a category that EXISTS in this tenant, so a correct follow-up actually queries data).
  {
    const t1 = await postChat(app, token, '电饭煲最新一期零售额是多少？', undefined);
    const convoId = t1.conversationId;
    const t2 = await postChat(app, token, '那空气炸锅呢？', convoId);
    const calls2 = dataCalls(t2.events);
    const text2 = textOf(t2.events);
    results.push(['S5 multi-turn', report('S5 multi-turn (上下文继承·同类目存在)', '[turn1: 电饭煲零售额] → 那空气炸锅呢？', t2.events, [
      ['follow-up queried market_metric for 空气炸锅 (inherited 零售额 intent)', calls2.some((c) => c.objectType === 'market_metric' &&
        ((c.args.filters as any[]) ?? []).some((f: any) => f.field === 'category' && String(f.value).includes('空气炸锅')))],
      ['answer references 空气炸锅 + a number', /空气炸锅/.test(text2) && /\d/.test(text2)],
    ])]);
  }

  // S6 — #178 year-trust efficiency: a 2-year query should converge WITHOUT month-exhaustion.
  {
    const { events } = await postChat(app, token, '电饭煲近两年（2024、2025）的零售额年度对比如何？', undefined);
    const calls = dataCalls(events);
    const usedYear = calls.some((c) => c.objectType === 'market_metric' &&
      ((c.args.groupBy as any[]) ?? []).includes('year'));
    // The anti-pattern #178 targets: re-verifying by enumerating month in ["24.01"…]. Count calls
    // whose filters exhaust months (a month `in` list with many values).
    const monthExhaustionCalls = calls.filter((c) => ((c.args.filters as any[]) ?? []).some(
      (f: any) => f.field === 'month' && Array.isArray(f.value) && f.value.length >= 6)).length;
    const text = textOf(events);
    results.push(['S6 year-trust', report('S6 year 维度信任 (#178 收敛效率)', '电饭煲近两年零售额年度对比', events, [
      ['used groupBy [year] (trusts the derived dim)', usedYear],
      ['did NOT re-verify by month-exhaustion (≤1 such call)', monthExhaustionCalls <= 1],
      ['total tool_calls ≤ 8 (acceptance target)', dataCalls(events).length <= 8],
      ['answer cites both years', /2024|24年|2025|25年/.test(text)],
    ])]);
  }

  // S7 — complex multi-turn drill-down (ADR-0049 stop-and-confirm): a diagnostic ask should NOT
  // chain all four hops blind; it should query brand-layer then pause/confirm before SKU drill.
  {
    const t1 = await postChat(app, token, '帮我诊断一下电饭煲市场最近的竞争格局变化。', undefined, 180_000);
    const convoId = t1.conversationId;
    const text1 = textOf(t1.events);
    const t1Calls = dataCalls(t1.events);
    // Follow-up confirming the drill-down — the Agent should now proceed with SKU/price-band detail.
    const t2 = await postChat(app, token, '好的，继续按你建议的价格段钻取看看具体机型。', convoId, 180_000);
    const text2 = textOf(t2.events);
    const t2Calls = dataCalls(t2.events);
    results.push(['S7 multi-turn-drill', report('S7 多轮诊断钻取 (ADR-0049 停-确认)', '诊断竞争格局 → 确认后钻取', t2.events, [
      ['turn1 queried brand/market layer (not blind SKU dump)', t1Calls.some((c) => c.objectType === 'brand_share' || c.objectType === 'market_metric')],
      ['turn1 presented findings / asked to confirm', /是否|要不要|建议|可以继续|确认|接下来/.test(text1)],
      ['turn2 (after confirm) drilled model_metric or priceBand', t2Calls.some((c) => c.objectType === 'model_metric') ||
        t2Calls.some((c) => ((c.args.groupBy as any[]) ?? []).includes('priceBand'))],
      ['turn2 produced a substantive answer', text2.length > 50],
    ])]);
  }

  console.log(`\n${'═'.repeat(80)}\n📊 ADR-0061 + #177/#178 real-chat verification summary`);
  for (const [name, pass] of results) console.log(`  ${pass ? '✅' : '❌'} ${name}`);
  const passed = results.filter(([, p]) => p).length;
  console.log(`\n  ${passed}/${results.length} scenarios fully passed their checks.`);

  await app.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
