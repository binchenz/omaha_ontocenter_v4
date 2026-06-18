#!/usr/bin/env ts-node
/**
 * UAT harness: simulate a REAL user driving the chat endpoint over the live server.
 *
 * Unlike test-agent-live-server.ts (single-shot, text-only), this harness:
 *  - Threads conversationId so multi-turn scenarios share real history.
 *  - Captures full per-turn telemetry: TTFB, total latency, every tool_call + args,
 *    chart emissions, confirmation gates, errors, and the final text.
 *  - Auto-answers the stop-and-confirm drill gate (simulating a user clicking 确认),
 *    so multi-step strategic flows complete instead of stalling.
 *
 * Run:  npx ts-node --transpile-only scripts/uat-chat-harness.ts
 * Out:  /tmp/uat-chat-results.json  (+ console summary)
 */
import { PrismaClient } from '@omaha/db';
import { BASE_URL, createToken } from './test-utils';

interface TurnTelemetry {
  message: string;
  http: number;
  ttfbMs: number;
  totalMs: number;
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
  charts: Array<Record<string, unknown>>;
  confirmation?: { toolName: string; message: string };
  error?: string;
  text: string;
  eventCounts: Record<string, number>;
}

/** A live conversation: one conversationId reused across turns. */
class ChatSession {
  conversationId?: string;
  constructor(private token: string, private surface = 'consume') {}

  async send(message: string, opts: { autoConfirm?: boolean } = {}): Promise<TurnTelemetry> {
    const tel = await this.post({ message, surface: this.surface, conversationId: this.conversationId });
    // If the agent stopped at a drill-confirm gate, simulate the user approving it
    // and fold the resumed stream's telemetry into this turn.
    if (tel.confirmation && opts.autoConfirm !== false && this.conversationId) {
      const resumed = await this.postConfirm(this.conversationId, true);
      tel.toolCalls.push(...resumed.toolCalls);
      tel.charts.push(...resumed.charts);
      tel.text = resumed.text || tel.text;
      tel.totalMs += resumed.totalMs;
      for (const [k, v] of Object.entries(resumed.eventCounts)) tel.eventCounts[k] = (tel.eventCounts[k] || 0) + v;
      tel.confirmation = { ...tel.confirmation, ...{ resolved: true } as any };
    }
    return tel;
  }

  private async post(body: Record<string, unknown>): Promise<TurnTelemetry> {
    return this.consume(`${BASE_URL}/agent/chat`, body, String(body.message ?? ''));
  }
  private async postConfirm(conversationId: string, confirmed: boolean): Promise<TurnTelemetry> {
    return this.consume(`${BASE_URL}/agent/confirm`, { conversationId, confirmed }, '[confirm]');
  }

  private async consume(url: string, body: Record<string, unknown>, label: string): Promise<TurnTelemetry> {
    const t0 = Date.now();
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const tel: TurnTelemetry = {
      message: label, http: resp.status, ttfbMs: 0, totalMs: 0,
      toolCalls: [], charts: [], text: '', eventCounts: {},
    };
    if (!resp.ok) { tel.error = `HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`; tel.totalMs = Date.now() - t0; return tel; }

    const reader = resp.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let firstByte = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!firstByte) firstByte = Date.now() - t0;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const json = line.slice(5).trim();
        if (!json || json === '[DONE]') continue;
        let e: any;
        try { e = JSON.parse(json); } catch { continue; }
        tel.eventCounts[e.type] = (tel.eventCounts[e.type] || 0) + 1;
        switch (e.type) {
          case 'tool_call':
            tel.toolCalls.push({ name: e.name, args: e.args });
            if (e.name === 'render_chart') tel.charts.push(e.args);
            break;
          case 'text': tel.text = e.content; break;
          case 'confirmation_request': tel.confirmation = { toolName: e.toolName, message: e.message }; break;
          case 'error': tel.error = e.message; break;
          case 'done': if (e.conversationId) this.conversationId = e.conversationId; break;
        }
      }
    }
    tel.ttfbMs = firstByte;
    tel.totalMs = Date.now() - t0;
    return tel;
  }
}

interface Scenario {
  id: string;
  kind: 'single' | 'multi';
  intent: string;
  turns: string[];           // one entry for single, N for multi
  expect: string;            // human-readable expectation (judged later)
}

const SCENARIOS: Scenario[] = [
  // ── A. Single-turn month-report retrieval (the bread-and-butter use case) ──
  { id: 'A1', kind: 'single', intent: '月报取数:零售额', turns: ['电饭煲 26.04 的零售额是多少？'], expect: '报出零售额数字 + 来源' },
  { id: 'A2', kind: 'single', intent: '月报取数:零售量', turns: ['空气炸锅 2026年4月线上零售量是多少？'], expect: '报出零售量' },
  { id: 'A3', kind: 'single', intent: '月报取数:均价', turns: ['电压力锅 26.04 的零售均价？'], expect: '报出均价(元)' },
  { id: 'A4', kind: 'single', intent: '份额查询(自有品牌)', turns: ['我们在电饭煲 26.04 的份额是多少？'], expect: '解析 selfBrands 小米/米家并报合并份额%' },
  { id: 'A5', kind: 'single', intent: '份额查询(竞品)', turns: ['美的电饭煲 26.04 的份额是多少？'], expect: '报美的份额%(priceBand=整体)' },
  { id: 'A6', kind: 'single', intent: 'TOP-N 排名', turns: ['电饭煲 26.04 份额最高的 5 个品牌是哪些？'], expect: '列出 TOP5 品牌+份额,不 punt' },

  // ── B. Charts (render_chart, the third advertised capability) ──
  { id: 'B1', kind: 'single', intent: '柱状图请求', turns: ['把电饭煲 26.04 份额 TOP5 品牌画成柱状图'], expect: '触发 render_chart 工具,bar' },
  { id: 'B2', kind: 'single', intent: '趋势折线图', turns: ['画一下电饭煲零售额最近几期的趋势折线图'], expect: '触发 render_chart line,跨 period' },

  // ── C. Multi-turn: pronoun / ellipsis / context carry-over ──
  { id: 'C1', kind: 'multi', intent: '代词指代+追问', turns: [
      '电饭煲 26.04 零售额是多少？',
      '那零售量呢？',
      '环比上一期涨了还是跌了？',
    ], expect: '第2轮理解"那"=电饭煲26.04;第3轮自动取上一期对比' },
  { id: 'C2', kind: 'multi', intent: '维度切换省略', turns: [
      '美的电饭煲 26.04 份额？',
      '九阳呢？',
      '这两家谁更高？',
    ], expect: '第2轮承接电饭煲26.04份额;第3轮比较两者' },
  { id: 'C3', kind: 'multi', intent: '钻取后聚合', turns: [
      '电饭煲 26.04 哪些品牌份额超过 5%？',
      '它们加起来占多少？',
    ], expect: '第2轮对上一轮品牌集合求和' },

  // ── D. Strategic / open-ended analysis (the hard tail) ──
  { id: 'D1', kind: 'single', intent: '自有品牌战略定位', turns: [
      '从份额角度看,小米/米家在电饭煲品类目前处于什么竞争位置？和头部品牌差距多大？'], expect: '收敛给出定位判断+数字支撑,不超时不 punt' },
  { id: 'D2', kind: 'single', intent: '弱项诊断(universe纪律)', turns: [
      '我们在电饭煲哪些价格段表现最弱？'], expect: '指出低份额价格段,不把低份额误称"真空/空白"' },
  { id: 'D3', kind: 'multi', intent: '多轮战略展开', turns: [
      '电饭煲品类整体市场现在是增长还是萎缩？',
      '在这个大盘下,我们(小米/米家)的份额走势如何？',
      '基于以上,给一句话的策略建议。',
    ], expect: '逐轮累积:大盘趋势→自有走势→落地建议' },

  // ── E. Robustness / negatives (real users fat-finger and ask out-of-scope) ──
  { id: 'E1', kind: 'single', intent: '不存在的期次', turns: ['电饭煲 2027年12月的零售额是多少？'], expect: '如实说无该期数据,不编造' },
  { id: 'E2', kind: 'single', intent: '不存在的品类', turns: ['我们洗碗机的份额是多少？'], expect: '说明无洗碗机品类(universe外),不幻觉' },
  { id: 'E3', kind: 'single', intent: '元问题(能力边界)', turns: ['你能帮我做什么？我能问哪些问题？'], expect: '清楚说明可做数据查询/分析/图表,基于现有品类' },
  { id: 'E4', kind: 'single', intent: '含糊请求', turns: ['帮我分析一下电饭煲'], expect: '不报错;要么追问要么给概览,不空转' },
];

async function main() {
  console.log('=== Chat UAT Harness (real-user simulation) ===\n');
  // health
  try {
    const h = await fetch(`${BASE_URL}/health`);
    if (!h.ok) throw new Error(String(h.status));
    console.log('✓ server healthy\n');
  } catch (e: any) { console.error(`❌ server not reachable at ${BASE_URL}`); process.exit(1); }

  const prisma = new PrismaClient();
  const tenant = await prisma.tenant.findFirst({ where: { slug: 'org-a05f8f3a' } });
  if (!tenant) { console.error('❌ 纯米 tenant missing'); process.exit(1); }
  const user = await prisma.user.findFirst({ where: { tenantId: tenant.id } });
  if (!user) { console.error('❌ no user'); process.exit(1); }
  const token = createToken(user.id, tenant.id, user.email, user.roleId);
  console.log(`Tenant: ${tenant.name} | User: ${user.email}\n`);
  await prisma.$disconnect();

  const allResults: Array<{ scenario: Scenario; turns: TurnTelemetry[] }> = [];

  // Run scenarios with limited concurrency (each scenario is sequential internally).
  const CONCURRENCY = 4;
  let idx = 0;
  async function worker() {
    while (idx < SCENARIOS.length) {
      const s = SCENARIOS[idx++];
      const session = new ChatSession(token);
      const turns: TurnTelemetry[] = [];
      for (const msg of s.turns) {
        try {
          const tel = await session.send(msg, { autoConfirm: true });
          turns.push(tel);
        } catch (err: any) {
          turns.push({ message: msg, http: 0, ttfbMs: 0, totalMs: 0, toolCalls: [], charts: [], text: '', eventCounts: {}, error: err.message });
        }
      }
      allResults.push({ scenario: s, turns });
      const last = turns[turns.length - 1];
      const tc = turns.reduce((n, t) => n + t.toolCalls.length, 0);
      const ch = turns.reduce((n, t) => n + t.charts.length, 0);
      const maxMs = Math.max(...turns.map((t) => t.totalMs));
      const errd = turns.some((t) => t.error);
      console.log(`[${s.id}] ${s.intent} — turns=${turns.length} tools=${tc} charts=${ch} maxMs=${maxMs}${errd ? ' ⚠ERROR' : ''}`);
      console.log(`     last: ${(last.text || last.error || '(empty)').replace(/\n/g, ' ').slice(0, 160)}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  // Order results by scenario id for stable output
  allResults.sort((a, b) => a.scenario.id.localeCompare(b.scenario.id));

  const fs = require('fs');
  fs.writeFileSync('/tmp/uat-chat-results.json', JSON.stringify(allResults, null, 2));
  console.log('\n✓ wrote /tmp/uat-chat-results.json');

  // Aggregate telemetry
  const flat = allResults.flatMap((r) => r.turns);
  const lat = flat.map((t) => t.totalMs).sort((a, b) => a - b);
  const ttfb = flat.map((t) => t.ttfbMs).filter((x) => x > 0).sort((a, b) => a - b);
  const pct = (arr: number[], p: number) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0;
  console.log('\n=== Latency (all turns) ===');
  console.log(`  turns=${flat.length}  errors=${flat.filter((t) => t.error).length}`);
  console.log(`  total ms: p50=${pct(lat, 0.5)} p90=${pct(lat, 0.9)} max=${lat[lat.length - 1]}`);
  console.log(`  TTFB  ms: p50=${pct(ttfb, 0.5)} p90=${pct(ttfb, 0.9)} max=${ttfb[ttfb.length - 1]}`);
  console.log(`  total tool_calls=${flat.reduce((n, t) => n + t.toolCalls.length, 0)} charts=${flat.reduce((n, t) => n + t.charts.length, 0)}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
