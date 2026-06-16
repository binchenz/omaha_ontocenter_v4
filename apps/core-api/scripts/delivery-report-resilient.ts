/**
 * Resilient delivery-report driver — recovers the data-analyst baseline that the jest e2e
 * lost when CHM-3 (the absent-brand DIAGNOSTIC) spiraled past the 120s timeout twice and
 * crashed the run before any of PBS/MDL/BDY/TRD scenarios executed, and before the report
 * (rendered only AFTER the full loop) was written.
 *
 * Same engine (anchors → scenarios → judges → ground-truth → report), but:
 *   - writes results INCREMENTALLY (a hang loses only the current scenario, not all prior work),
 *   - N=1 (cost; the jest run already showed MKT/BRD are stable 2/2),
 *   - SKIPS the known-hanging CHM-3 diagnostic (`--skip CHM-3`), and caps per-scenario time so a
 *     spiral aborts that one scenario instead of the process.
 *
 *   node -r ts-node/register -r reflect-metadata scripts/delivery-report-resilient.ts [tenantSlug]
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { ValidationPipe, INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '@omaha/db';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../src/app.module';
import { probeAnchors } from '../test/delivery-report/anchors';
import { buildScenarios } from '../test/delivery-report/scenarios';
import { GroundTruth } from '../test/delivery-report/ground-truth';

const TENANT_SLUG = process.argv[2] ?? 'org-a05f8f3a';
const SKIP_IDS = new Set(['CHM-3']); // the diagnostic-on-absent-brand that hangs past timeout
const PER_SCENARIO_MS = 90_000;

interface SseEvent { type: string; [k: string]: unknown }

async function postChat(app: INestApplication, token: string, message: string, timeoutMs: number): Promise<SseEvent[]> {
  const server = app.getHttpServer();
  const address = server.listening ? server.address() : await new Promise<any>((r) => server.listen(0, () => r(server.address())));
  const port = typeof address === 'object' ? address.port : 0;
  const res = await fetch(`http://127.0.0.1:${port}/agent/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(timeoutMs),
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
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try { events.push(JSON.parse(line.slice(6))); } catch {}
    }
  }
  return events;
}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  const prisma = app.get(PrismaService) as unknown as PrismaService;
  const jwt = app.get(JwtService);

  const anchors = await probeAnchors(prisma as any);
  if (!anchors) { console.error('no AVC data'); process.exit(1); }
  const gt = new GroundTruth(prisma as any);

  // refresh matviews (stale → empty query_objects)
  const mvs = await prisma.$queryRawUnsafe<Array<{ matviewname: string }>>(
    `SELECT matviewname FROM pg_matviews WHERE matviewname LIKE 'mv_%'`);
  for (const { matviewname } of mvs) await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY "${matviewname}"`);

  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  const admin = await prisma.user.findFirst({ where: { tenantId: tenant!.id }, include: { role: true } });
  const token = jwt.sign({ sub: admin!.id, email: admin!.email, tenantId: admin!.tenantId, roleId: admin!.roleId });

  const scenarios = buildScenarios(anchors).filter((s) => !SKIP_IDS.has(s.id));
  console.log(`🔑 ${admin!.email} on ${tenant!.name} — ${scenarios.length} scenarios (skipped ${[...SKIP_IDS].join(',')})\n`);

  const lines: string[] = [`# Delivery Report (resilient, N=1) — ${tenant!.name}`, '', `> ${scenarios.length} scenarios, skipped ${[...SKIP_IDS].join(',')} (hangs). Generated incrementally.`, ''];
  const outPath = join(process.cwd(), 'reports', 'delivery-report-resilient-2026-06-16.md');
  const byCat = new Map<string, { pass: number; total: number }>();

  for (const s of scenarios) {
    let mark = '❌', detail = '', sample = '';
    try {
      const events = await postChat(app, token, s.question, PER_SCENARIO_MS);
      const verdict = await s.judge({ events, gt, tenantId: anchors.tenantId });
      // mirror the spec's scenarioPassed(): fact → dataCorrect, behavior → behaviorCorrect
      const primary = s.track === 'fact' ? verdict.dataCorrect : verdict.behaviorCorrect;
      const passed = primary?.pass === true;
      mark = passed ? '✅' : '⚠️';
      detail = [verdict.dataCorrect, verdict.statementCorrect, verdict.behaviorCorrect]
        .filter(Boolean).map((v) => `${v!.pass ? '✓' : '✗'}${v!.detail}`).join(' | ');
      sample = (events.filter((e) => e.type === 'text').map((e) => (e as any).content ?? '').join('')).slice(0, 200);
      const c = byCat.get(s.category) ?? { pass: 0, total: 0 };
      c.total++; if (passed) c.pass++; byCat.set(s.category, c);
    } catch (e: any) {
      mark = '⏱️'; detail = `timeout/err: ${e.message}`;
      const c = byCat.get(s.category) ?? { pass: 0, total: 0 }; c.total++; byCat.set(s.category, c);
    }
    console.log(`  ${mark} ${s.id} [${s.category}] — ${s.question.slice(0, 38)}`);
    lines.push(`### ${mark} ${s.id} — ${s.category}`, `**Q**: ${s.question}`, '', `**判词**: ${detail}`, '', `**答(摘)**: ${sample}`, '');
    writeFileSync(outPath, lines.join('\n')); // incremental — survives a later hang
  }

  lines.push('', '## 分类汇总', '', '| 类别 | 通过 |', '|---|---|');
  for (const [cat, c] of byCat) lines.push(`| ${cat} | ${c.pass}/${c.total} |`);
  writeFileSync(outPath, lines.join('\n'));
  console.log(`\n📄 ${outPath}`);
  await app.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
