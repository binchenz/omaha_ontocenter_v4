/**
 * Axis-A Falsification Suite — measures whether enum-constrained tool params
 * (conditional oneOf) reduce illegal-query / retry-roundtrip rate vs main.
 *
 * baseline-first: run this on pristine main FIRST to capture the real failure
 * rate (B group should show illegal→retry; A group should be clean), THEN
 * implement dynamic oneOf and re-run for the A/B contrast.
 *
 * This is a MEASUREMENT harness, not a pass/fail gate. It prints per-scenario
 * tallies. Run with: pnpm --filter core-api test:e2e --testPathPattern=axis-a
 *
 * Prereqs: demo-drama seeded (19811 shots / 427 episodes), DEEPSEEK_API_KEY set.
 */
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@omaha/db';
import request from 'supertest';
import { createTestApp, postSse, SseEvent } from './test-helpers';

const TENANT_SLUG = 'demo-drama';
const ADMIN_EMAIL = 'admin@demo-drama.local';
const ADMIN_PASSWORD = 'demo2026';
const N = parseInt(process.env.AXIS_A_N || '6', 10);

// Runtime-verified legal field sets (probed against the DB, not ontology.ts).
const SHOT_FILTERABLE = new Set(['shotNum', 'startTime', 'endTime', 'duration', 'scene', 'shotSize', 'angle', 'movement', 'subject', 'dialogue', 'mood']);
const SHOT_NUMERIC = new Set(['shotNum', 'startTime', 'endTime', 'duration']);
const EPISODE_FILTERABLE = new Set(['series', 'episodeNo', 'clipDuration', 'shotCount']);
const EPISODE_NUMERIC = new Set(['clipDuration', 'shotCount']);

function filterableFor(ot: string): Set<string> {
  return ot === 'shot' ? SHOT_FILTERABLE : ot === 'episode' ? EPISODE_FILTERABLE : new Set();
}
function numericFor(ot: string): Set<string> {
  return ot === 'shot' ? SHOT_NUMERIC : ot === 'episode' ? EPISODE_NUMERIC : new Set();
}

function getArgs(e: SseEvent): Record<string, unknown> {
  const raw = (e as any).arguments ?? (e as any).args ?? {};
  if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return {}; } }
  return raw as Record<string, unknown>;
}

const isDataTool = (e: SseEvent) => e.type === 'tool_call' && (e.name === 'query_objects' || e.name === 'aggregate_objects');

/** Collect every field referenced by an aggregate/query call, tagged by role. */
function fieldsOf(args: Record<string, unknown>): { groupBy: string[]; metricFields: string[]; filterFields: string[]; sortField?: string } {
  const groupBy = (args.groupBy as string[]) ?? [];
  const metricFields = ((args.metrics as Array<{ field?: string }>) ?? []).map(m => m.field).filter(Boolean) as string[];
  const filterFields = ((args.filters as Array<{ field?: string }>) ?? []).map(f => f.field).filter(Boolean) as string[];
  const sortField = (args.sort as { field?: string } | undefined)?.field;
  return { groupBy, metricFields, filterFields, sortField };
}

/** Is the FIRST data-tool call legal against the engine's real constraints? */
function firstCallLegal(args: Record<string, unknown>): { legal: boolean; reason?: string } {
  const ot = args.objectType as string;
  const filt = filterableFor(ot);
  const num = numericFor(ot);
  if (filt.size === 0) return { legal: false, reason: `unknown objectType=${ot}` };
  const f = fieldsOf(args);
  for (const g of f.groupBy) if (!filt.has(g)) return { legal: false, reason: `groupBy '${g}' not filterable on ${ot}` };
  for (const mf of f.metricFields) if (!num.has(mf)) return { legal: false, reason: `metric field '${mf}' not numeric on ${ot}` };
  for (const ff of f.filterFields) if (!filt.has(ff)) return { legal: false, reason: `filter field '${ff}' not filterable on ${ot}` };
  if (f.sortField && !num.has(f.sortField) && !filt.has(f.sortField)) return { legal: false, reason: `sort '${f.sortField}' not sortable on ${ot}` };
  return { legal: true };
}

interface RunMetrics {
  firstCallLegal: boolean;
  firstCallReason?: string;
  dataCallCount: number;       // >1 ⇒ a retry roundtrip happened
  hadErrorResult: boolean;     // any tool_result carried an {error}
  finalResultOk: boolean;      // last tool_result had data and no error
  firstArgs?: Record<string, unknown>;
}

function analyze(events: SseEvent[]): RunMetrics {
  const dataCalls = events.filter(isDataTool);
  const results = events.filter(e => e.type === 'tool_result');
  const firstArgs = dataCalls.length ? getArgs(dataCalls[0]) : undefined;
  const legal = firstArgs ? firstCallLegal(firstArgs) : { legal: false, reason: 'no data-tool call' };

  // NOTE on retry detection: executeTool() returns null on a thrown tool error
  // (orchestrator.service.ts:218-221) — it pushes the error into messages but
  // emits NO tool_result event. So an illegal query that throws is invisible in
  // tool_result events; its signature is instead a SECOND data-tool call
  // (the LLM self-heals on the error fed back). Hence dataCallCount > 1 is the
  // retry-roundtrip signal, and a missing tool_result after a data-call implies
  // that call threw.
  const dataResultCount = results.filter(r => r.name === 'query_objects' || r.name === 'aggregate_objects').length;
  const someDataCallThrew = dataCalls.length > dataResultCount; // emitted a call but got no result back

  // tool_result.data is the SDK return wrapped by orchestrator ({type:'tool_result', data: result}).
  //   query_objects   → result = { data: [...rows], meta }     (array at .data)
  //   aggregate_objects→ result = { groups: [...], truncated } (array at .groups, TOP-LEVEL)
  // A successful payload has one of those arrays and no top-level `error`.
  const okPayload = (d: any) => !!d && typeof d === 'object' && !('error' in d) &&
    (Array.isArray(d.data) || Array.isArray(d.groups));
  const last = results[results.length - 1] as any;
  const finalResultOk = okPayload(last?.data);

  return {
    firstCallLegal: legal.legal,
    firstCallReason: legal.reason,
    dataCallCount: dataCalls.length,
    hadErrorResult: someDataCallThrew,
    finalResultOk,
    firstArgs,
  };
}

/** A-group: was the semantically-correct sibling field chosen on the first call? */
function aGroupCorrectField(args: Record<string, unknown> | undefined, expected: string): boolean {
  if (!args) return false;
  const f = fieldsOf(args);
  const all = [...f.groupBy, ...f.metricFields, ...f.filterFields, ...(f.sortField ? [f.sortField] : [])];
  return all.includes(expected);
}

interface Scenario {
  id: string;
  group: 'B' | 'A' | 'DIAG';
  message: string;
  expectField?: string; // A-group: the correct sibling field
  note: string;
}

const SCENARIOS: Scenario[] = [
  // B group — non-filterable field traps. main should pick an illegal field (→ throw → retry); axis A should make it structurally impossible.
  { id: 'B1', group: 'B', message: '按旁白内容把镜头分组，统计每种旁白有多少个镜头', note: 'lures groupBy narration (NOT filterable)' },
  { id: 'B2', group: 'B', message: '按音效类型给镜头分组，看看每种音效用了多少次', note: 'lures groupBy/filter audio (NOT filterable)' },
  { id: 'B3', group: 'B', message: '统计每种字幕分别出现在多少个镜头里', note: 'lures groupBy subtitle (NOT filterable)' },
  { id: 'B4', group: 'B', message: '按人物动作给镜头分类，统计各类动作的镜头数量', note: 'lures groupBy action (NOT filterable)' },
  // A group — legal sibling disambiguation. axis A should NOT change behavior (enum has all siblings); pure ADR-0023 prose job.
  { id: 'A1', group: 'A', message: '找出最先开始的 5 个镜头', expectField: 'startTime', note: 'startTime vs duration/endTime/shotNum' },
  { id: 'A2', group: 'A', message: '哪个镜头时长最长？', expectField: 'duration', note: 'duration vs startTime/endTime' },
  { id: 'A3', group: 'A', message: '列出序号在 100 以后的镜头', expectField: 'shotNum', note: 'shotNum (ordinal) vs count/duration' },
  // DIAG — cross-object false-green (S4). NOT scored for axis A; quantifies the ADR-0026 2/8 illegal rate in the real pipeline.
  { id: 'B5', group: 'DIAG', message: '哪部剧特写镜头最多？', note: 'S4 decoy: wants groupBy series, but series is episode-only' },
];

describe('Axis-A Falsification Suite (measurement, not gate)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaClient();
    const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
    if (!tenant) throw new Error('demo-drama tenant not found — seed first');
    const shots = await prisma.objectInstance.count({ where: { tenantId: tenant.id, objectType: 'shot' } });
    if (shots < 100) throw new Error(`Expected shots > 100, got ${shots}`);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, tenantSlug: TENANT_SLUG });
    expect(login.status).toBe(201);
    token = login.body.accessToken;
  }, 60_000);

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
    if (app) await app.close();
  }, 30_000);

  it(`measures B/A/DIAG over N=${N} runs each`, async () => {
    const rows: Array<{ s: Scenario; runs: RunMetrics[]; aCorrect: number }> = [];
    for (const s of SCENARIOS) {
      const runs: RunMetrics[] = [];
      let aCorrect = 0;
      for (let i = 0; i < N; i++) {
        let events: SseEvent[] = [];
        try {
          events = await postSse(app, '/agent/chat', { message: s.message }, token);
        } catch (e) {
          runs.push({ firstCallLegal: false, firstCallReason: `postSse threw: ${(e as Error).message?.slice(0, 60)}`, dataCallCount: 0, hadErrorResult: true, finalResultOk: false });
          continue;
        }
        const m = analyze(events);
        runs.push(m);
        if (s.group === 'A' && s.expectField && aGroupCorrectField(m.firstArgs, s.expectField)) aCorrect++;
      }
      rows.push({ s, runs, aCorrect });
    }
    printReport(rows, N);
    expect(rows.length).toBe(SCENARIOS.length);
  }, 20 * 60_000);
});

function pct(n: number, d: number): string { return `${n}/${d}`; }

function printReport(rows: Array<{ s: Scenario; runs: RunMetrics[]; aCorrect: number }>, n: number): void {
  const L: string[] = [];
  L.push(`\n${'='.repeat(78)}\nAXIS-A FALSIFICATION REPORT  (N=${n} per scenario)\n${'='.repeat(78)}`);
  L.push(`legend: firstLegal=first data-call legal | retry=runs with >1 data-call | err=runs w/ error result | finalOk=runs w/ valid final result`);
  for (const group of ['B', 'A', 'DIAG'] as const) {
    const gr = rows.filter(r => r.s.group === group);
    if (!gr.length) continue;
    L.push(`\n── ${group} group ${'─'.repeat(60)}`);
    for (const { s, runs, aCorrect } of gr) {
      const firstLegal = runs.filter(r => r.firstCallLegal).length;
      const retry = runs.filter(r => r.dataCallCount > 1).length;
      const err = runs.filter(r => r.hadErrorResult).length;
      const finalOk = runs.filter(r => r.finalResultOk).length;
      L.push(`  ${s.id} [${s.note}]`);
      L.push(`     firstLegal=${pct(firstLegal, n)}  retry=${pct(retry, n)}  err=${pct(err, n)}  finalOk=${pct(finalOk, n)}` +
        (s.group === 'A' && s.expectField ? `  correctField(${s.expectField})=${pct(aCorrect, n)}` : ''));
      // show a couple of illegal first-call reasons for diagnosis
      const reasons = [...new Set(runs.filter(r => !r.firstCallLegal && r.firstCallReason).map(r => r.firstCallReason!))].slice(0, 3);
      if (reasons.length) L.push(`     illegal reasons: ${reasons.join(' | ')}`);
    }
  }
  // group aggregates for the headline comparison
  const agg = (g: 'B' | 'A') => {
    const gr = rows.filter(r => r.s.group === g).flatMap(r => r.runs);
    const tot = gr.length || 1;
    return {
      firstLegal: gr.filter(r => r.firstCallLegal).length,
      retry: gr.filter(r => r.dataCallCount > 1).length,
      err: gr.filter(r => r.hadErrorResult).length,
      finalOk: gr.filter(r => r.finalResultOk).length,
      tot,
    };
  };
  const b = agg('B'), a = agg('A');
  L.push(`\n── HEADLINE ${'─'.repeat(60)}`);
  L.push(`  B group (axis-A target): firstLegal=${pct(b.firstLegal, b.tot)} retry=${pct(b.retry, b.tot)} err=${pct(b.err, b.tot)} finalOk=${pct(b.finalOk, b.tot)}`);
  L.push(`  A group (control)      : firstLegal=${pct(a.firstLegal, a.tot)} retry=${pct(a.retry, a.tot)} err=${pct(a.err, a.tot)} finalOk=${pct(a.finalOk, a.tot)}`);
  L.push(`${'='.repeat(78)}\n`);
  // eslint-disable-next-line no-console
  console.log(L.join('\n'));
}
