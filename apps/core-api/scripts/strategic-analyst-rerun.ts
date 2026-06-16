/**
 * Strategic-analyst RE-RUN — verifies the #193-#198 fixes landed on the REAL 纯米 agent, and
 * stress-tests them. Successor to strategic-analyst-eval.ts (kept intact for before/after audit).
 *
 * WHAT CHANGED vs the original harness (and WHY):
 *   1. AUTO-CONFIRM/RESUME. #195 now pauses (confirmation_request → done, stream ends) before the
 *      first model_metric SKU drill. The old harness had no confirm handling, so it would misread
 *      the pause as "stalled / no answer" — the exact OLD failure signature. Here `converse()`
 *      loops: on confirmation_request it POSTs /agent/confirm and keeps reading, so drilling
 *      scenarios reach their FULL answer (apples-to-apples with last round) while still recording
 *      that the gate fired. S8 deliberately DECLINES (confirmed:false) to test clean abort.
 *   2. S1 VERDICT REFRAMED. Pre-#193 the ideal was "反问 / guess 小米"; the bug was silently
 *      answering whole-market. POST-#193 (selfBrands=[小米,米家] seeded live) the ideal is the
 *      OPPOSITE: directly resolve 我们 → 小米/米家 and report the merged ~6.34%.
 *   3. NEW STRESS S7-S10: S7 convergence worst-case (#194🔴 — all-category open Q must not spiral
 *      to timeout), S8 drill-decline (#195🟠), S9 universe-trap reframe (#196🟠 — "哪段最该放弃"
 *      must still use brand_share, no false vacuum), S10 REVERSE identity-merge (#193 — 空气炸锅
 *      22.12 has 小米=0% / 米家=3.42%, so a 小米-only merge reports ~0% = fail; correct = 3.42%).
 *
 * Read-only SQL oracle, hits REAL DeepSeek, non-deterministic, mutates nothing, prints a report.
 *
 *   LLM_DEBUG=1 LLM_DEBUG_DIR=.llm-debug/rerun \
 *     node -r ts-node/register -r reflect-metadata scripts/strategic-analyst-rerun.ts [tenantSlug]
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

const TENANT_SLUG = process.argv[2] ?? 'org-a05f8f3a';
const CHUNMI_BRANDS = ['小米', '米家']; // 纯米's products in AVC data

interface SseEvent { type: string; [k: string]: unknown }

// ──────────────────────────── SSE plumbing ──────────────────────────────────────────────────
function getArgs(e: SseEvent): Record<string, unknown> {
  if (typeof e.arguments === 'string') return safeParse(e.arguments);
  if (typeof e.args === 'string') return safeParse(e.args);
  return (e.arguments ?? e.args ?? {}) as Record<string, unknown>;
}
function safeParse(s: string): Record<string, unknown> { try { return JSON.parse(s); } catch { return {}; } }
function textOf(events: SseEvent[]): string {
  return events.filter((e) => e.type === 'text').map((e) => (e as any).content ?? '').join('');
}
function systemPromptOf(events: SseEvent[]): string {
  return (events.find((e) => e.type === 'system_prompt') as any)?.content ?? '';
}
interface Call { name: string; objectType?: string; args: Record<string, unknown> }
function dataCalls(events: SseEvent[]): Call[] {
  return events.filter((e) => e.type === 'tool_call')
    .map((e) => ({ name: (e as any).name, args: getArgs(e) }))
    .map((c) => ({ ...c, objectType: c.args.objectType as string | undefined }));
}

function portOf(app: INestApplication): Promise<number> {
  const server = app.getHttpServer();
  if (server.listening) return Promise.resolve(server.address().port);
  return new Promise((r) => server.listen(0, () => r(server.address().port)));
}

/** One raw SSE round-trip: POST a JSON body, read data: lines to end-of-stream. */
async function readSse(port: number, route: string, token: string, body: unknown, timeoutMs: number): Promise<SseEvent[]> {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
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

interface ConverseResult { events: SseEvent[]; conversationId?: string; pauses: number; declined: boolean }

/**
 * Drive one analyst message to completion, auto-resolving #195 drill-gate pauses.
 * `decision='confirm'` continues the drill (the analyst says yes); `'decline'` aborts it
 * (confirmed:false). Loops because resume() re-enters executeLoop with a fresh gate, so a
 * confirmed drill can pause again; capped by maxConfirms.
 */
async function converse(
  app: INestApplication, token: string, message: string, conversationId: string | undefined,
  { decision = 'confirm', maxConfirms = 4, timeoutMs = 240_000 }:
    { decision?: 'confirm' | 'decline'; maxConfirms?: number; timeoutMs?: number } = {},
): Promise<ConverseResult> {
  const port = await portOf(app);
  let events = await readSse(port, '/agent/chat', token, { message, ...(conversationId ? { conversationId } : {}) }, timeoutMs);
  const convId = (events.find((e) => (e as any).conversationId) as any)?.conversationId ?? conversationId;
  let pauses = 0;
  let declined = false;
  let all = [...events];

  while (events.some((e) => e.type === 'confirmation_request') && pauses < maxConfirms && convId) {
    pauses++;
    const confirmed = decision === 'confirm';
    if (!confirmed) declined = true;
    events = await readSse(port, '/agent/confirm', token,
      { conversationId: convId, confirmed, ...(confirmed ? {} : { comment: '分析师本轮不需要钻取到机型，请基于已有的品牌/价格段数据作答。' }) },
      timeoutMs);
    all = all.concat(events);
    if (!confirmed) break; // a decline resolves the gate; the continuation answers from broad data
  }
  return { events: all, conversationId: convId, pauses, declined };
}

// ──────────────────────────── Independent raw-SQL ground-truth oracle ────────────────────────
class Oracle {
  constructor(private prisma: PrismaService, private tenantId: string) {}

  async chunmiShare(category: string, period: string, brands = CHUNMI_BRANDS): Promise<number> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ v: number }>>(
      `SELECT COALESCE(SUM((properties->>'value')::float8),0) AS v FROM object_instances
        WHERE tenant_id=$1::uuid AND object_type='brand_share' AND deleted_at IS NULL
          AND properties->>'category'=$2 AND properties->>'period'=$3
          AND properties->>'priceBand'='整体' AND properties->>'brand'=ANY($4)`,
      this.tenantId, category, period, brands);
    return Number(rows[0]?.v ?? 0);
  }

  async chunmiShareSeries(category: string): Promise<Array<{ period: string; share: number }>> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ period: string; v: number }>>(
      `SELECT properties->>'period' AS period, SUM((properties->>'value')::float8) AS v
         FROM object_instances
        WHERE tenant_id=$1::uuid AND object_type='brand_share' AND deleted_at IS NULL
          AND properties->>'category'=$2 AND properties->>'priceBand'='整体'
          AND properties->>'brand'=ANY($3)
        GROUP BY properties->>'period' ORDER BY 1`,
      this.tenantId, category, CHUNMI_BRANDS);
    return rows.map((r) => ({ period: r.period, share: Number(r.v) }));
  }

  async topBrands(category: string, period: string, n = 8): Promise<Array<{ brand: string; share: number }>> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ brand: string; v: number }>>(
      `SELECT properties->>'brand' AS brand, MAX((properties->>'value')::float8) AS v
         FROM object_instances
        WHERE tenant_id=$1::uuid AND object_type='brand_share' AND deleted_at IS NULL
          AND properties->>'category'=$2 AND properties->>'period'=$3 AND properties->>'priceBand'='整体'
        GROUP BY properties->>'brand' ORDER BY 2 DESC LIMIT $4`,
      this.tenantId, category, period, n);
    return rows.map((r) => ({ brand: r.brand, share: Number(r.v) }));
  }

  /** 纯米 (小米+米家) share by price band — the WHOLE-MARKET universe (#196 truth). */
  async chunmiByBand(category: string, period: string): Promise<Array<{ band: string; share: number }>> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ band: string; v: number }>>(
      `SELECT properties->>'priceBand' AS band, SUM((properties->>'value')::float8) AS v
         FROM object_instances
        WHERE tenant_id=$1::uuid AND object_type='brand_share' AND deleted_at IS NULL
          AND properties->>'category'=$2 AND properties->>'period'=$3
          AND properties->>'priceBand' <> '整体' AND properties->>'brand'=ANY($4)
        GROUP BY properties->>'priceBand' ORDER BY 2 DESC`,
      this.tenantId, category, period, CHUNMI_BRANDS);
    return rows.map((r) => ({ band: r.band, share: Number(r.v) }));
  }

  async latestPeriod(category: string): Promise<string> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ p: string }>>(
      `SELECT MAX(properties->>'period') AS p FROM object_instances
        WHERE tenant_id=$1::uuid AND object_type='brand_share' AND properties->>'category'=$2`,
      this.tenantId, category);
    return rows[0]?.p ?? '';
  }

  async chunmiCrossCategory(): Promise<Array<{ category: string; share: number }>> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ category: string; v: number }>>(
      `WITH latest AS (
         SELECT properties->>'category' c, MAX(properties->>'period') p FROM object_instances
          WHERE tenant_id=$1::uuid AND object_type='brand_share' GROUP BY 1)
       SELECT oi.properties->>'category' AS category, SUM((oi.properties->>'value')::float8) AS v
         FROM object_instances oi JOIN latest l
           ON oi.properties->>'category'=l.c AND oi.properties->>'period'=l.p
        WHERE oi.tenant_id=$1::uuid AND oi.object_type='brand_share'
          AND oi.properties->>'priceBand'='整体' AND oi.properties->>'brand'=ANY($2)
        GROUP BY 1 ORDER BY 2 DESC`,
      this.tenantId, CHUNMI_BRANDS);
    return rows.map((r) => ({ category: r.category, share: Number(r.v) }));
  }

  async hasModelData(category: string, month: string): Promise<number> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*)::int AS n FROM object_instances
        WHERE tenant_id=$1::uuid AND object_type='model_metric' AND deleted_at IS NULL
          AND properties->>'category'=$2 AND properties->>'month'=$3`,
      this.tenantId, category, month);
    return Number(rows[0]?.n ?? 0);
  }
}

// ──────────────────────────── trace printing ────────────────────────────────────────────────
function printTurn(label: string, message: string, r: ConverseResult): void {
  const calls = dataCalls(r.events);
  const text = textOf(r.events);
  const errs = r.events.filter((e) => e.type === 'error');
  const sysPrompt = systemPromptOf(r.events);
  console.log(`\n  ── ${label} «${message.slice(0, 60)}${message.length > 60 ? '…' : ''}» ──`);
  if (sysPrompt) console.log(`  [system_prompt chars=${sysPrompt.length}]`);
  console.log(`  [${calls.length} tool_calls, ${r.pauses} pause(s)${r.declined ? ' DECLINED' : ''}, ${errs.length} errors]`);
  for (const c of calls) {
    const f = (c.args.filters as any[]) ?? [];
    const fStr = f.map((x) => `${x.field}${x.operator ?? '='}${JSON.stringify(x.value)}`).join(' ');
    const g = (c.args.groupBy as any[]) ?? [];
    const m = (c.args.metrics as any[]) ?? [];
    console.log(`    • ${c.name}(${c.objectType ?? '—'}) f:[${fStr}] g:[${g.join(',')}] m:[${m.map((x: any) => `${x.kind}(${x.field ?? '*'})`).join(',')}]`);
  }
  if (errs.length) console.log(`    ⚠ ${errs.map((e) => (e as any).message ?? JSON.stringify(e)).join(' | ')}`);
  console.log(`  答: ${(text.replace(/\n/g, '\n     ').slice(0, 1200)) || '(no text)'}`);
}

function checkRow(label: string, pass: boolean | null, detail: string): void {
  const mark = pass === null ? '·' : pass ? '✅' : '❌';
  console.log(`    ${mark} ${label} — ${detail}`);
}
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
/** Does the prose cite a percentage within tol of target? */
function citesPct(text: string, target: number, tol = 0.005): boolean {
  return [...text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].some((m) => Math.abs(parseFloat(m[1]) / 100 - target) <= tol);
}

// ──────────────────────────── main ──────────────────────────────────────────────────────────
async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  const prisma = app.get(PrismaService);
  const jwt = app.get(JwtService);
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) { console.error(`❌ tenant ${TENANT_SLUG} not found`); process.exit(1); }
  const admin = await prisma.user.findFirst({ where: { tenantId: tenant.id }, include: { role: true } });
  if (!admin) { console.error('❌ no admin'); process.exit(1); }
  const token = jwt.sign({ sub: admin.id, email: admin.email, tenantId: admin.tenantId, roleId: admin.roleId });
  const oracle = new Oracle(prisma, tenant.id);
  console.log(`🔑 strategic-analyst RE-RUN — acting as ${admin.email} on ${tenant.name} (${tenant.slug})`);

  const CAT = '电饭煲';
  const LATEST = await oracle.latestPeriod(CAT); // 26.04
  const PRIMER = `背景：我是纯米科技的战略分析师。纯米的产品在 AVC 数据里以「小米」和「米家」两个品牌出现，请把这两个品牌合起来当作我们纯米来分析。`;

  // ═══ S1 — COLD identity probe (NO primer). POST-#193 ideal: directly resolve 我们→小米/米家. ═══
  console.log(`\n${'═'.repeat(90)}\nS1 冷开身份探（无 primer）— 验 #193：应直接解析「我们」=小米/米家 并报合并份额`);
  {
    const r = await converse(app, token, '我们最近在电饭煲市场的份额怎么样？大概排第几？', undefined);
    printTurn('S1', '我们最近在电饭煲的份额怎么样', r);
    const text = textOf(r.events);
    const gtShare = await oracle.chunmiShare(CAT, LATEST);
    const resolvedBrands = /小米|米家/.test(text);
    const citesMerged = citesPct(text, gtShare, 0.01);
    const fabricated = /纯米.*\d+(\.\d+)?\s*%/.test(text);
    console.log(`\n    ── 分解事实核查 ── GT 纯米(小米+米家) ${CAT} ${LATEST} 整体份额 = ${pct(gtShare)}`);
    checkRow('#193 直接把「我们」解析到 小米/米家（理想）', resolvedBrands, resolvedBrands ? '已解析到自有品牌' : '未解析（仍回避身份）');
    checkRow('报出合并份额数字 ≈ GT', citesMerged, citesMerged ? `命中 ≈${pct(gtShare)}` : `未命中 ${pct(gtShare)}`);
    checkRow('未编造「纯米 X%」', !fabricated, fabricated ? '⚠ 出现编造的纯米数字' : '未编造');
  }

  // ═══ S2 — price-band attack (primer→multi-turn). Regression of last round's universe miss. ═══
  console.log(`\n${'═'.repeat(90)}\nS2 价格段攻防（primer→多轮）— 回归：核查段位份额、universe 是否选对`);
  {
    const t0 = await converse(app, token, PRIMER + ` 先告诉我，我们在电饭煲最新一期的整体份额是多少？`, undefined);
    printTurn('S2.turn1', 'primer + 我们电饭煲整体份额', t0);
    const t1 = await converse(app, token, `结合各价格段，我们目前在哪个价格段最强、哪个价格段几乎是空白？如果要重点进攻，你建议哪个段？给出依据。`, t0.conversationId);
    printTurn('S2.turn2', '该重点进攻哪个价格段', t1);

    const gtShare = await oracle.chunmiShare(CAT, LATEST);
    const gtBands = await oracle.chunmiByBand(CAT, LATEST);
    const allText = textOf(t0.events) + '\n' + textOf(t1.events);
    const usedBrandShare = dataCalls([...t0.events, ...t1.events]).some((c) => c.objectType === 'brand_share');
    const usedModelMetric = dataCalls(t1.events).some((c) => c.objectType === 'model_metric');
    console.log(`\n    ── 分解事实核查 ──`);
    console.log(`    GT 纯米 ${CAT} ${LATEST} 整体=${pct(gtShare)}；价格段 top5: ${gtBands.slice(0, 5).map((b) => `${b.band}=${pct(b.share)}`).join(', ')}`);
    const topBand = gtBands[0]?.band;
    checkRow('整体份额数字命中 GT', citesPct(allText, gtShare, 0.01), `GT ${pct(gtShare)}`);
    checkRow('价格段问题用 brand_share（universe 对）', usedBrandShare, usedBrandShare ? '用了 brand_share' : '未用 brand_share');
    checkRow('未拿 model_metric 当价格段口径', !usedModelMetric, usedModelMetric ? '⚠ 又走了 model_metric' : '未走 model_metric');
    checkRow('「最强段」断言可核', topBand ? new RegExp(topBand.replace(/[-]/g, '[\\-–]')).test(allText) : null, `GT 最强段=${topBand}`);
    // #196 false-vacuum guard: 400-500 had 0.66% last round; must not be called 真空.
    const band400 = gtBands.find((b) => b.band === '400-500');
    const falseVacuum = /400[\-–]500.*(?:真空|空白|为零|没有|不存在)/.test(allText.replace(/\s/g, ''));
    checkRow('未把有份额的段误称「真空」', band400 ? !falseVacuum : null, band400 ? `400-500 实际=${pct(band400.share)}；${falseVacuum ? '⚠ 仍称真空' : '未误称'}` : 'N/A');
  }

  // ═══ S3 — competitive landscape. Verify the brand ranking. ═══
  console.log(`\n${'═'.repeat(90)}\nS3 竞品定位（primer→多轮）— 回归：核查 TOP 品牌排名`);
  {
    const r = await converse(app, token, PRIMER + ` 在电饭煲市场，谁是我们最主要的竞争对手？给出最新一期 TOP5 品牌及份额。`, undefined);
    printTurn('S3', '谁是我们主要对手 TOP5', r);
    const gt = await oracle.topBrands(CAT, LATEST, 6);
    const text = textOf(r.events);
    console.log(`\n    ── 分解事实核查 ── GT TOP6 ${CAT} ${LATEST}: ${gt.map((b) => `${b.brand}(${pct(b.share)})`).join(', ')}`);
    const top3 = gt.slice(0, 3).map((b) => b.brand);
    const mentioned = top3.filter((b) => text.includes(b));
    checkRow('TOP3 品牌均被提及', mentioned.length === 3, `命中 ${mentioned.join('/') || '无'} / 应含 ${top3.join('/')}`);
    checkRow('未把自己(小米/米家)误列为竞品', null, /竞争对手.{0,6}(小米|米家)|(小米|米家).{0,6}竞争对手/.test(text) ? '⚠ 可能自指为对手' : '未见自指错误');
    const top1 = gt[0];
    const m = text.match(new RegExp(`${top1.brand}[^0-9]{0,12}(\\d+(?:\\.\\d+)?)\\s*%`));
    checkRow(`#1 ${top1.brand} 份额数字一致(±0.5pt)`, m ? Math.abs(parseFloat(m[1]) / 100 - top1.share) <= 0.005 : null,
      m ? `答=${parseFloat(m[1]).toFixed(2)}% GT=${pct(top1.share)}` : '答中未给可解析百分比');
  }

  // ═══ S4 — trend synthesis. Verify the 5-period series + the up/down 措辞. ═══
  console.log(`\n${'═'.repeat(90)}\nS4 趋势综合（primer→多轮）— 回归：核查 5 期份额 + 涨跌措辞`);
  {
    const r = await converse(app, token, PRIMER + ` 我们在电饭煲过去几年的整体份额走势如何？是持续上升、见顶回落，还是震荡？请给出各期数字并判断趋势。`, undefined);
    printTurn('S4', '我们过去几年份额走势', r);
    const series = await oracle.chunmiShareSeries(CAT);
    const text = textOf(r.events);
    console.log(`\n    ── 分解事实核查 ── GT 序列: ${series.map((s) => `${s.period}=${pct(s.share)}`).join(' → ')}`);
    const peak = series.reduce((a, b) => (b.share > a.share ? b : a), series[0]);
    const last = series[series.length - 1];
    const isPeakedFalling = peak.period !== last.period && last.share < peak.share;
    const citedNums = [...text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => parseFloat(m[1]) / 100);
    const matched = series.filter((s) => citedNums.some((c) => Math.abs(c - s.share) <= 0.003));
    checkRow('引用期份数字命中 GT', matched.length >= 3, `命中 ${matched.length}/${series.length} 期（±0.3pt）`);
    checkRow('趋势措辞与数据一致', null, `GT ${isPeakedFalling ? `见顶(${peak.period}=${pct(peak.share)})回落` : '单调/震荡'}；人工核对答中"上升/回落/震荡"`);
  }

  // ═══ S5 — honesty boundary. essence period has NO model layer; must not fabricate SKUs. ═══
  console.log(`\n${'═'.repeat(90)}\nS5 诚实边界（primer→多轮）— 回归：essence 期无机型层，测是否编造 SKU`);
  {
    const r = await converse(app, token, PRIMER + ` 我们空气炸锅 26.04 这一期卖得最好的几款具体机型(SKU)是哪些？给出机型名和份额。`, undefined);
    printTurn('S5', '空气炸锅 26.04 我们的 TOP 机型', r);
    const n = await oracle.hasModelData('空气炸锅', '26.04');
    const text = textOf(r.events);
    console.log(`\n    ── 分解事实核查 ── GT model_metric(空气炸锅, 26.04) 行数 = ${n}（0=essence 期，无机型）`);
    const admits = /没有.*机型|无.*机型|essence|精华版|未覆盖|不提供.*机型|无法.*机型|缺少.*机型|该期.*没有|仅.*品牌层|没有 ?SKU|无 ?SKU/.test(text);
    checkRow('诚实承认无机型数据', n === 0 ? admits : null, n === 0 ? (admits ? '已承认' : '⚠ 未承认') : 'N/A');
  }

  // ═══ S6 — cross-category (regression of the old TIMEOUT). Auto-confirm drives to an answer. ═══
  console.log(`\n${'═'.repeat(90)}\nS6 跨品类（primer→多轮）— 回归：上轮 ~40call 超时；现应收敛出答案`);
  {
    const start = Date.now();
    const r = await converse(app, token, PRIMER + ` 综合来看，我们在你能查到的这些品类里，哪几个品类份额最强、哪几个最弱？据此你建议我们资源往哪倾斜？`, undefined, { timeoutMs: 280_000 });
    const secs = ((Date.now() - start) / 1000).toFixed(0);
    printTurn('S6', '我们最强/最弱品类 + 资源建议', r);
    const cross = await oracle.chunmiCrossCategory();
    const text = textOf(r.events);
    console.log(`\n    ── 分解事实核查 (${secs}s) ── GT 跨品类: ${cross.map((c) => `${c.category}=${pct(c.share)}`).join(', ')}`);
    const strongest = cross[0]?.category, weakest = cross[cross.length - 1]?.category;
    checkRow('收敛出答案（不再超时）', text.length > 50, text.length > 50 ? `出答案 (${dataCalls(r.events).length} calls)` : '❌ 无答案');
    checkRow('最强品类断言可核', strongest ? text.includes(strongest) : null, `GT 最强=${strongest}`);
    checkRow('最弱品类断言可核', weakest ? text.includes(weakest) : null, `GT 最弱=${weakest}`);
  }

  // ═══ S7 — CONVERGENCE worst-case (#194🔴). All-category × multi-period open Q must not spiral. ═══
  console.log(`\n${'═'.repeat(90)}\nS7 收敛最坏情况（#194🔴）— 全品类×多期开放问题，验 dedup+软预算+收敛`);
  {
    const start = Date.now();
    const r = await converse(app, token,
      PRIMER + ` 请把我们能查到的所有品类、所有有数据的周期都过一遍：每个品类我们各期的份额是多少、整体是涨是跌、当前在该品类排第几、主要对手是谁。最后给一个总体的强弱与资源建议。`,
      undefined, { timeoutMs: 290_000 });
    const secs = ((Date.now() - start) / 1000).toFixed(0);
    printTurn('S7', '全品类全周期大综合', r);
    const calls = dataCalls(r.events);
    const text = textOf(r.events);
    const errs = r.events.filter((e) => e.type === 'error');
    console.log(`\n    ── 收敛核查 (${secs}s) ──`);
    checkRow('未炸穿超时、出了答案', text.length > 80, text.length > 80 ? `出答案 ${secs}s` : `❌ 无答案/超时 ${secs}s`);
    checkRow('tool_call 受控（≤16，软预算+dedup 生效）', calls.length <= 16, `${calls.length} calls`);
    checkRow('无 MAX_TOOL_ITERATIONS 报错', !errs.some((e) => /最大工具/.test((e as any).message ?? '')), errs.length ? errs.map((e) => (e as any).message).join('|') : '无报错');
  }

  // ═══ S8 — drill DECLINE (#195🟠). Diagnostic triggers gate; analyst declines; must abort clean. ═══
  console.log(`\n${'═'.repeat(90)}\nS8 下钻拒绝 confirmed:false（#195🟠）— 触发 drill-gate 后拒绝，应干净中止并基于宽层作答`);
  {
    const r = await converse(app, token,
      PRIMER + ` 帮我深入诊断一下我们在电饭煲的竞争短板，并钻取到具体机型(SKU)层面看看问题出在哪。`,
      undefined, { decision: 'decline' });
    printTurn('S8', '诊断+钻取到机型（将拒绝钻取）', r);
    const text = textOf(r.events);
    const errs = r.events.filter((e) => e.type === 'error');
    const drilled = dataCalls(r.events).some((c) => c.objectType === 'model_metric');
    console.log(`\n    ── 拒绝路径核查 ──`);
    checkRow('drill-gate 触发了暂停', r.pauses > 0, `pauses=${r.pauses}`);
    checkRow('拒绝后未真正钻到 model_metric', !drilled, drilled ? '⚠ 仍执行了 model_metric' : '未钻取');
    checkRow('拒绝后仍给出基于宽层的答复', text.length > 50 && errs.length === 0, `${errs.length ? '有error' : '无error'}, 答长=${text.length}`);
  }

  // ═══ S9 — UNIVERSE-TRAP reframe (#196🟠). "哪段最该放弃" tempts model_metric; must stay brand_share. ═══
  console.log(`\n${'═'.repeat(90)}\nS9 universe 诱陷重框（#196🟠）— 「哪个价格段最该放弃」诱走 model_metric，应仍 brand_share`);
  {
    const r = await converse(app, token,
      PRIMER + ` 资源有限，我们电饭煲最新一期里哪个价格段最鸡肋、最该放弃？哪个段几乎没有我们的存在？请按价格段给出我们的份额依据。`,
      undefined);
    printTurn('S9', '哪个价格段最该放弃', r);
    const gtBands = await oracle.chunmiByBand(CAT, LATEST);
    const text = textOf(r.events);
    const usedBrandShare = dataCalls(r.events).some((c) => c.objectType === 'brand_share');
    const usedModelMetric = dataCalls(r.events).some((c) => c.objectType === 'model_metric');
    console.log(`\n    ── 分解事实核查 ── GT 纯米 价格段(降序): ${gtBands.map((b) => `${b.band}=${pct(b.share)}`).join(', ')}`);
    const trulyEmpty = gtBands.filter((b) => b.share < 0.001).map((b) => b.band);
    const hasSome = gtBands.find((b) => b.band === '400-500');
    const falseVacuum = hasSome ? new RegExp(`400[\\-–]500[^。]{0,30}(真空|空白|为零|没有|不存在|放弃)`).test(text.replace(/\s/g, '')) : false;
    checkRow('价格段问题用 brand_share（全市场口径）', usedBrandShare, usedBrandShare ? '用了 brand_share' : '❌ 未用');
    checkRow('未误用 model_metric 当价格段', !usedModelMetric, usedModelMetric ? '⚠ 走了 model_metric' : '未走');
    checkRow('真正空白段断言与 GT 一致', null, `GT <0.1% 段: ${trulyEmpty.join(',') || '(无)'}`);
    checkRow('未把有份额的 400-500 误判为该放弃', hasSome ? !falseVacuum : null, hasSome ? `400-500 实际=${pct(hasSome.share)}` : 'N/A');
  }

  // ═══ S10 — REVERSE identity merge (#193). 空气炸锅 22.12: 小米=0%, 米家=3.42%. 合并应=3.42%. ═══
  console.log(`\n${'═'.repeat(90)}\nS10 身份合并反向验（#193）— 空气炸锅 22.12 由「米家」独扛，小米只算=0% 即失败`);
  {
    const r = await converse(app, token, '我们空气炸锅在 22.12 这一期的整体市场份额大概是多少？', undefined);
    printTurn('S10', '我们空气炸锅 22.12 整体份额', r);
    const gtMerged = await oracle.chunmiShare('空气炸锅', '22.12');         // 3.42%
    const gtXiaomiOnly = await oracle.chunmiShare('空气炸锅', '22.12', ['小米']); // 0%
    const text = textOf(r.events);
    console.log(`\n    ── 分解事实核查 ── GT 合并(小米+米家)=${pct(gtMerged)}；仅小米=${pct(gtXiaomiOnly)}（米家独扛）`);
    const citesMerged = citesPct(text, gtMerged, 0.008);
    const mentionsMijia = /米家/.test(text);
    checkRow('报出合并份额 ≈ 米家口径 3.42%（合并对）', citesMerged, citesMerged ? `命中 ≈${pct(gtMerged)}` : `未命中 ${pct(gtMerged)}`);
    checkRow('识别该期由「米家」承载', mentionsMijia, mentionsMijia ? '提到米家' : '未提及米家');
    checkRow('未塌缩成「仅小米≈0%」', !/(0\.0|接近0|几乎没有|约为0|0%)/.test(text) || citesMerged, citesMerged ? '报了合并值' : '⚠ 疑似只算小米');
  }

  console.log(`\n${'═'.repeat(90)}\n📊 战略分析师 RE-RUN 完成。trace 写入 LLM_DEBUG_DIR；准确性=各场景核查、措辞/收敛=人工读 trace。`);
  await app.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
