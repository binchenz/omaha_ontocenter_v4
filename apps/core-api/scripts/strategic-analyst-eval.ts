/**
 * Strategic-analyst real-chat evaluation for the live 纯米 tenant.
 *
 * UNLIKE the data-analyst delivery-report (single-fact lookups with one ground-truth number),
 * this harness drives OPEN-ENDED, MULTI-TURN strategic questions in the FIRST PERSON ("我们纯米"),
 * the way 纯米's own strategy team would actually consult the agent. There is no single
 * ground-truth answer for "该攻哪个价格段" — so accuracy is judged by DECOMPOSITION: every
 * atomic numeric/ranking/trend CLAIM the agent makes is extracted and checked against an
 * independent raw-SQL oracle here. The strategic reasoning + 措辞 are left for human read of
 * the printed trace.
 *
 * Two evaluation axes (the user's two goals):
 *   Goal 1 — accuracy (data + 措辞): per-scenario claim-vs-SQL table + honesty checks.
 *   Goal 2 — prompt/toolcall optimization headroom: every LLM round-trip is dumped via
 *            LLM_DEBUG=1 to .llm-debug/strategic/, and per-scenario we print round count,
 *            tool_call sequence, and prompt size so the trace can be audited offline.
 *
 * KEY GROUNDING FACTS (probed from live org-a05f8f3a):
 *   - AVC data has NO "纯米" brand string. 纯米's products appear as 小米 + 米家, split in
 *     the share layer. 米家 has no 电饭煲 整体 rows; only 小米 does there.
 *   - The tenant profile injected into the prompt does NOT enumerate brands (167 > cap 20)
 *     and does NOT say "you are 纯米". So a COLD first-person ask hits a pure identity gap.
 *   - S1 is the cold identity probe (no primer). S2-S6 give an analyst PRIMER first turn
 *     ("我们纯米的产品在 AVC 数据里以 小米 和 米家 出现"), isolating reasoning from the gap.
 *
 * This HITS REAL DeepSeek, is non-deterministic, mutates NOTHING (read-only SQL oracle),
 * and PRINTS a structured report for human judgement.
 *
 *   LLM_DEBUG=1 LLM_DEBUG_DIR=.llm-debug/strategic \
 *     node -r ts-node/register -r reflect-metadata scripts/strategic-analyst-eval.ts [tenantSlug]
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
interface Turn { label: string; message: string; events: SseEvent[]; conversationId?: string }

// ──────────────────────────── SSE plumbing (mirrors verify-adr0061-chat) ────────────────────
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
function toolResults(events: SseEvent[]): Array<{ name: string; data: unknown }> {
  return events.filter((e) => e.type === 'tool_result').map((e) => ({ name: (e as any).name, data: (e as any).data }));
}

async function postChat(
  app: INestApplication, token: string, message: string,
  conversationId: string | undefined, timeoutMs = 180_000,
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
  const convo = events.find((e) => (e as any).conversationId);
  return { events, conversationId: (convo as any)?.conversationId ?? conversationId };
}

// ──────────────────────────── Independent raw-SQL ground-truth oracle ────────────────────────
class Oracle {
  constructor(private prisma: PrismaService, private tenantId: string) {}

  /** Sum of 小米+米家 整体 share for a category+period (纯米's combined whole-market share). */
  async chunmiShare(category: string, period: string): Promise<number> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ v: number }>>(
      `SELECT COALESCE(SUM((properties->>'value')::float8),0) AS v FROM object_instances
        WHERE tenant_id=$1::uuid AND object_type='brand_share' AND deleted_at IS NULL
          AND properties->>'category'=$2 AND properties->>'period'=$3
          AND properties->>'priceBand'='整体' AND properties->>'brand'=ANY($4)`,
      this.tenantId, category, period, CHUNMI_BRANDS);
    return Number(rows[0]?.v ?? 0);
  }

  /** 纯米 (小米+米家) 整体 share trajectory across all brand_share periods for a category. */
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

  /** Top-N brands by 整体 share for a category+period (the competitive landscape). */
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

  /** 小米 share by price band for a category+period (where 纯米 actually plays). */
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

  /** Latest period label for a category's brand_share. */
  async latestPeriod(category: string): Promise<string> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ p: string }>>(
      `SELECT MAX(properties->>'period') AS p FROM object_instances
        WHERE tenant_id=$1::uuid AND object_type='brand_share' AND properties->>'category'=$2`,
      this.tenantId, category);
    return rows[0]?.p ?? '';
  }

  /** 小米 整体 share for every category at its latest period (cross-category strength map). */
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

  /** Does model_metric exist for category+month? (honesty boundary — essence periods have none.) */
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
function printTurn(t: Turn): void {
  const calls = dataCalls(t.events);
  const text = textOf(t.events);
  const errs = t.events.filter((e) => e.type === 'error');
  const sysPrompt = systemPromptOf(t.events);
  console.log(`\n  ── ${t.label} «${t.message}» ──`);
  if (sysPrompt) console.log(`  [system_prompt chars=${sysPrompt.length}]`);
  console.log(`  [rounds≈${calls.length} tool_calls, ${errs.length} errors]`);
  for (const c of calls) {
    const f = (c.args.filters as any[]) ?? [];
    const fStr = f.map((x) => `${x.field}${x.operator ?? '='}${JSON.stringify(x.value)}`).join(' ');
    const g = (c.args.groupBy as any[]) ?? [];
    const m = (c.args.metrics as any[]) ?? [];
    console.log(`    • ${c.name}(${c.objectType ?? '—'}) filters:[${fStr}] groupBy:[${g.join(',')}] metrics:[${m.map((x: any) => `${x.kind}(${x.field ?? '*'})`).join(',')}]`);
  }
  if (errs.length) console.log(`    ⚠ ${errs.map((e) => (e as any).message ?? JSON.stringify(e)).join(' | ')}`);
  console.log(`  答: ${(text.replace(/\n/g, '\n     ').slice(0, 1400)) || '(no text)'}`);
}

function checkRow(label: string, pass: boolean | null, detail: string): void {
  const mark = pass === null ? '·' : pass ? '✅' : '❌';
  console.log(`    ${mark} ${label} — ${detail}`);
}
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

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
  console.log(`🔑 strategic-analyst eval — acting as ${admin.email} on ${tenant.name} (${tenant.slug})`);

  const CAT = '电饭煲';
  const LATEST = await oracle.latestPeriod(CAT); // 26.04
  const PRIMER = `背景：我是纯米科技的战略分析师。纯米的产品在 AVC 数据里以「小米」和「米家」两个品牌出现，请把这两个品牌合起来当作我们纯米来分析。`;

  // ═══ S1 — COLD identity probe (NO primer): can the agent resolve "我们" with zero hints? ═══
  console.log(`\n${'═'.repeat(90)}\nS1 冷开身份探（无 primer）— 测身份解析 / 是否反问 / 是否乱猜`);
  {
    const { events } = await postChat(app, token, '我们最近在电饭煲市场的份额怎么样？大概排第几？', undefined);
    printTurn({ label: 'S1', message: '我们最近在电饭煲的份额怎么样', events });
    const text = textOf(events);
    const asksWho = /哪个品牌|哪家|您是|你们是|贵公司|具体品牌|是指|请问.*品牌|未.*指明|无法确定.*品牌|没有.*纯米/.test(text);
    const guessedChunmi = /小米|米家/.test(text);
    checkRow('是否反问/澄清身份（理想行为）', asksWho, asksWho ? '反问了品牌身份' : '未反问');
    checkRow('是否自行猜到 小米/米家（次优但可接受）', guessedChunmi, guessedChunmi ? '提到了 小米/米家' : '未提到');
    checkRow('是否乱编一个「纯米」份额（失败模式）', null, /纯米.*\d+(\.\d+)?\s*%/.test(text) ? '⚠ 出现"纯米 X%"——疑似编造' : '未见编造的纯米数字');
  }

  // ═══ S2 — price-band attack (primer → strategic). Verify every band share it cites. ═══
  console.log(`\n${'═'.repeat(90)}\nS2 价格段攻防（primer→多轮）— 核查它引用的段位份额`);
  {
    const t0 = await postChat(app, token, PRIMER + ` 先告诉我，我们在电饭煲最新一期的整体份额是多少？`, undefined);
    printTurn({ label: 'S2.turn1', message: 'primer + 我们电饭煲整体份额', events: t0.events });
    const t1 = await postChat(app, token, `结合各价格段，我们目前在哪个价格段最强、哪个价格段几乎是空白？如果要重点进攻，你建议哪个段？给出依据。`, t0.conversationId);
    printTurn({ label: 'S2.turn2', message: '该重点进攻哪个价格段', events: t1.events });

    const gtShare = await oracle.chunmiShare(CAT, LATEST);
    const gtBands = await oracle.chunmiByBand(CAT, LATEST);
    const allText = textOf(t0.events) + '\n' + textOf(t1.events);
    console.log(`\n    ── 分解事实核查（SQL oracle）──`);
    console.log(`    GT 纯米(小米+米家) ${CAT} ${LATEST} 整体份额 = ${pct(gtShare)}`);
    console.log(`    GT 纯米 价格段 top5: ${gtBands.slice(0, 5).map((b) => `${b.band}=${pct(b.share)}`).join(', ')}`);
    console.log(`    GT 纯米 几乎空白段(<0.1%): ${gtBands.filter((b) => b.share < 0.001).map((b) => b.band).join(', ') || '(无)'}`);
    // claim extraction: did the agent's strongest-band claim match GT's actual top band?
    const topBand = gtBands[0]?.band;
    checkRow('整体份额数字与 SQL 一致(±0.5pt)', null,
      `见答中份额表述 vs GT ${pct(gtShare)}（人工核对措辞）`);
    checkRow('「最强价格段」断言可核', topBand ? new RegExp(topBand.replace(/[-]/g, '[\\-–]')).test(allText) : null,
      `GT 最强段=${topBand}；答中${topBand && new RegExp(topBand.replace(/[-]/g, '[\\-–]')).test(allText) ? '提到' : '未提到'}该段`);
  }

  // ═══ S3 — competitive landscape. Verify the brand ranking. ═══
  console.log(`\n${'═'.repeat(90)}\nS3 竞品定位（primer→多轮）— 核查 TOP 品牌排名`);
  {
    const t0 = await postChat(app, token, PRIMER + ` 在电饭煲市场，谁是我们最主要的竞争对手？给出最新一期 TOP5 品牌及份额。`, undefined);
    printTurn({ label: 'S3', message: '谁是我们主要对手 TOP5', events: t0.events });
    const gt = await oracle.topBrands(CAT, LATEST, 6);
    const text = textOf(t0.events);
    console.log(`\n    ── 分解事实核查 ──`);
    console.log(`    GT TOP6 ${CAT} ${LATEST}: ${gt.map((b) => `${b.brand}(${pct(b.share)})`).join(', ')}`);
    const top3 = gt.slice(0, 3).map((b) => b.brand);
    const mentionedTop3 = top3.filter((b) => text.includes(b));
    checkRow('TOP3 品牌均被提及', mentionedTop3.length === 3, `命中 ${mentionedTop3.join('/') || '无'} / 应含 ${top3.join('/')}`);
    checkRow('是否把自己(小米/米家)误列为竞品', null, /竞争对手.*小米|小米.*竞争对手/.test(text) ? '⚠ 可能自指为对手' : '未见自指错误');
    // numeric spot-check: does the #1 brand's cited % match GT within tolerance?
    const top1 = gt[0];
    const m = text.match(new RegExp(`${top1.brand}[^0-9]{0,12}(\\d+(?:\\.\\d+)?)\\s*%`));
    if (m) {
      const cited = parseFloat(m[1]) / 100;
      checkRow(`#1 ${top1.brand} 份额数字一致(±0.5pt)`, Math.abs(cited - top1.share) <= 0.005,
        `答=${(cited * 100).toFixed(2)}% GT=${pct(top1.share)}`);
    } else checkRow(`#1 ${top1.brand} 份额数字`, null, '答中未给出可解析的百分比');
  }

  // ═══ S4 — trend synthesis. Verify the 5-period series + the up/down 措辞. ═══
  console.log(`\n${'═'.repeat(90)}\nS4 趋势综合（primer→多轮）— 核查 5 期份额 + 涨跌措辞`);
  {
    const t0 = await postChat(app, token, PRIMER + ` 我们在电饭煲过去几年的整体份额走势如何？是持续上升、见顶回落，还是震荡？请给出各期数字并判断趋势。`, undefined);
    printTurn({ label: 'S4', message: '我们过去几年份额走势', events: t0.events });
    const series = await oracle.chunmiShareSeries(CAT);
    const text = textOf(t0.events);
    console.log(`\n    ── 分解事实核查 ──`);
    console.log(`    GT 纯米 ${CAT} 整体份额序列: ${series.map((s) => `${s.period}=${pct(s.share)}`).join(' → ')}`);
    const peak = series.reduce((a, b) => (b.share > a.share ? b : a), series[0]);
    const last = series[series.length - 1];
    const isPeakedFalling = peak.period !== last.period && last.share < peak.share;
    checkRow('趋势措辞与数据一致', null,
      `GT ${isPeakedFalling ? `见顶(${peak.period}=${pct(peak.share)})回落` : '单调/震荡'}；人工核对答中"上升/回落/震荡"是否吻合`);
    // each cited %: count how many of the 5 GT values appear (±0.3pt) in the prose
    const citedNums = [...text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => parseFloat(m[1]) / 100);
    const matched = series.filter((s) => citedNums.some((c) => Math.abs(c - s.share) <= 0.003));
    checkRow('引用的期份数字命中 GT', matched.length >= 3, `命中 ${matched.length}/${series.length} 期（±0.3pt）`);
  }

  // ═══ S5 — honesty boundary. essence period has NO model layer; must not fabricate SKUs. ═══
  console.log(`\n${'═'.repeat(90)}\nS5 诚实边界（primer→多轮）— essence 期无机型层，测是否编造 SKU`);
  {
    const t0 = await postChat(app, token, PRIMER + ` 我们空气炸锅 26.04 这一期卖得最好的几款具体机型(SKU)是哪些？给出机型名和份额。`, undefined);
    printTurn({ label: 'S5', message: '空气炸锅 26.04 我们的 TOP 机型', events: t0.events });
    const n = await oracle.hasModelData('空气炸锅', '26.04');
    const text = textOf(t0.events);
    console.log(`\n    ── 分解事实核查 ──`);
    console.log(`    GT model_metric(空气炸锅, 26.04) 行数 = ${n}（0 = essence 期，无机型数据）`);
    const admits = /没有.*机型|无.*机型|essence|精华版|未覆盖|不提供.*机型|无法.*机型|缺少.*机型|该期.*没有|仅.*品牌层|没有 SKU|无 SKU/.test(text);
    // fabrication smell: a model-code-like token (letters+digits) presented as a 空气炸锅 SKU
    const skuLike = /[A-Z]{2,}[-0-9]{2,}|KZ[A-Z0-9]+|[A-Z][0-9]{3,}/.test(text);
    checkRow('诚实承认无机型数据', n === 0 ? admits : null, n === 0 ? (admits ? '已承认' : '⚠ 未承认') : 'N/A(该期有数据)');
    checkRow('未编造 SKU 机型号', n === 0 ? !skuLike : null, skuLike ? '⚠ 出现疑似机型号' : '未见编造机型号');
  }

  // ═══ S6 — cross-category strength. Verify the strongest/weakest category claim. ═══
  console.log(`\n${'═'.repeat(90)}\nS6 跨品类（primer→多轮）— 核查我们最强/最弱品类`);
  {
    const t0 = await postChat(app, token, PRIMER + ` 综合来看，我们在你能查到的这些品类里，哪几个品类份额最强、哪几个最弱？据此你建议我们资源往哪倾斜？`, undefined);
    printTurn({ label: 'S6', message: '我们最强/最弱品类 + 资源建议', events: t0.events });
    const cross = await oracle.chunmiCrossCategory();
    const text = textOf(t0.events);
    console.log(`\n    ── 分解事实核查 ──`);
    console.log(`    GT 纯米 跨品类 整体份额(各品类最新期): ${cross.map((c) => `${c.category}=${pct(c.share)}`).join(', ')}`);
    const strongest = cross[0]?.category;
    const weakest = cross[cross.length - 1]?.category;
    checkRow('最强品类断言可核', strongest ? text.includes(strongest) : null, `GT 最强=${strongest}；答中${strongest && text.includes(strongest) ? '提到' : '未提到'}`);
    checkRow('最弱品类断言可核', weakest ? text.includes(weakest) : null, `GT 最弱=${weakest}；答中${weakest && text.includes(weakest) ? '提到' : '未提到'}`);
  }

  console.log(`\n${'═'.repeat(90)}\n📊 战略分析师评估完成。trace 已写入 LLM_DEBUG_DIR（逐轮 prompt+toolcall）。`);
  console.log(`   准确性=上方各场景「分解事实核查」；措辞/推理=人工读 trace；prompt/toolcall 优化=审计 .llm-debug/strategic/*.json`);
  await app.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
