/**
 * Drama-co Agent acceptance test runner.
 *
 * Hits the running dev API server (default http://localhost:3001) with the
 * drama_co tenant admin token, runs each scenario from drama-agent-scenarios.ts,
 * fetches ground truth from the local Postgres for each, applies a fuzzy-match
 * judge, and emits a markdown report to stdout + scripts/test-results/.
 *
 * Usage:
 *   pnpm dev   # in another terminal — must be running
 *   pnpm --filter @omaha/scripts run test:drama-agent --smoke   # 10 scenarios, ~8min
 *   pnpm --filter @omaha/scripts run test:drama-agent --full    # all scenarios, ~40min
 *
 * Environment:
 *   OMAHA_API_BASE_URL    default http://localhost:3001
 *   DRAMA_CO_EMAIL        default admin@drama-co.local
 *   DRAMA_CO_PASSWORD     required
 *   DRAMA_CO_TENANT_SLUG  default drama_co
 *   DATABASE_URL          required (for ground-truth SQL)
 */

import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { scenarios, type Scenario, type GroundTruth } from './lib/drama-agent-scenarios';
import {
  judgeNumeric,
  judgeNameVariants,
  judgeSetMembership,
  type Judgement,
} from './lib/drama-agent-judges';

interface CliFlags {
  smoke: boolean;
  full: boolean;
}

function parseArgs(argv: string[]): CliFlags {
  return { smoke: argv.includes('--smoke'), full: argv.includes('--full') };
}

interface ScenarioResult {
  id: string;
  question: string;
  answer: string;
  durationMs: number;
  judgement: Judgement | { kind: 'human-review'; expectation: string };
  groundTruth: unknown;
  error?: string;
}

async function login(apiBase: string, email: string, password: string, tenantSlug: string): Promise<string> {
  const res = await fetch(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, tenantSlug }),
  });
  if (!res.ok) throw new Error(`Login failed: HTTP ${res.status} ${await res.text()}`);
  const body = await res.json() as { accessToken: string };
  return body.accessToken;
}

async function chat(apiBase: string, token: string, message: string): Promise<string> {
  const res = await fetch(`${apiBase}/agent/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.body) throw new Error('No response body');

  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buffer = '';
  let accumulatedText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const ev = JSON.parse(line.slice(6));
        if (ev.type === 'text' && typeof ev.content === 'string') {
          accumulatedText += ev.content;
        } else if (ev.type === 'text' && typeof ev.delta === 'string') {
          // backwards-compat — some agents emit delta chunks
          accumulatedText += ev.delta;
        } else if (ev.type === 'tool_call') {
          accumulatedText += `\n[tool_call: ${ev.name ?? '?'}(${JSON.stringify(ev.args ?? {})})]\n`;
        } else if (ev.type === 'tool_result') {
          const data = ev.data ?? ev.result;
          const preview = typeof data === 'string' ? data.slice(0, 300) : JSON.stringify(data ?? {}).slice(0, 300);
          accumulatedText += `\n[tool_result: ${preview}]\n`;
        } else if (ev.type === 'error') {
          accumulatedText += `\n[error: ${ev.message ?? ev.error ?? 'unknown'}]`;
        }
      } catch {}
    }
  }
  return accumulatedText;
}

async function fetchGroundTruth(pg: Client, gt: GroundTruth): Promise<unknown> {
  if (gt.kind === 'humanReview') return gt.expectation;
  const r = await pg.query(gt.sql);
  if (gt.kind === 'numeric') return r.rows[0]?.v;
  if (gt.kind === 'nameVariants') return r.rows[0]?.v;
  if (gt.kind === 'setMembership') return r.rows.map((row) => String(row.v));
  return null;
}

function judge(answer: string, gt: GroundTruth, gtValue: unknown): Judgement | { kind: 'human-review'; expectation: string } {
  if (gt.kind === 'humanReview') return { kind: 'human-review', expectation: gt.expectation };
  if (gt.kind === 'numeric') {
    if (typeof gtValue !== 'number') return { kind: 'fail', reason: 'ground truth missing' };
    return judgeNumeric(answer, gtValue);
  }
  if (gt.kind === 'nameVariants') {
    if (typeof gtValue !== 'string') return { kind: 'fail', reason: 'ground truth missing' };
    return judgeNameVariants(answer, [gtValue]);
  }
  if (gt.kind === 'setMembership') {
    if (!Array.isArray(gtValue)) return { kind: 'fail', reason: 'ground truth missing' };
    return judgeSetMembership(answer, gtValue as string[], gt.topK);
  }
  return { kind: 'fail', reason: 'unknown ground truth kind' };
}

function buildReport(results: ScenarioResult[], elapsed: number, mode: string): string {
  const lines: string[] = [];
  lines.push('# Drama-co Agent Acceptance Report');
  lines.push('');
  lines.push(`- Mode: \`${mode}\``);
  lines.push(`- Date: ${new Date().toISOString()}`);
  lines.push(`- Duration: ${(elapsed / 1000).toFixed(1)}s`);
  lines.push(`- Scenarios: ${results.length}`);
  const auto = results.filter((r) => r.judgement.kind === 'pass' || r.judgement.kind === 'fail');
  const human = results.filter((r) => r.judgement.kind === 'human-review');
  const errored = results.filter((r) => r.error);
  const passed = auto.filter((r) => r.judgement.kind === 'pass').length;
  const failed = auto.filter((r) => r.judgement.kind === 'fail').length;
  lines.push(`- Auto-judged: ${auto.length} (${passed} pass / ${failed} fail)`);
  lines.push(`- Human-review: ${human.length}`);
  lines.push(`- Errored: ${errored.length}`);
  lines.push('');

  // Auto section
  lines.push('## Auto-judged');
  lines.push('');
  for (const r of auto) {
    const status = r.judgement.kind === 'pass' ? '✓ PASS' : '✗ FAIL';
    const reason = r.judgement.kind === 'fail' ? ` — ${r.judgement.reason}` : '';
    lines.push(`### ${r.id} — ${status}${reason}`);
    lines.push('');
    lines.push(`**Q**: ${r.question}`);
    lines.push('');
    lines.push(`**Ground truth**: \`${JSON.stringify(r.groundTruth)}\``);
    lines.push('');
    lines.push(`**Answer** (${(r.durationMs / 1000).toFixed(1)}s):`);
    lines.push('');
    lines.push('```');
    lines.push(r.answer.slice(0, 6000) || '(empty)');
    lines.push('```');
    lines.push('');
  }

  // Human-review section
  lines.push('## Human-review');
  lines.push('');
  for (const r of human) {
    const expectation = (r.judgement as { expectation: string }).expectation;
    lines.push(`### ${r.id}`);
    lines.push('');
    lines.push(`**Q**: ${r.question}`);
    lines.push('');
    lines.push(`**Expectation**: ${expectation}`);
    lines.push('');
    lines.push(`**Answer** (${(r.durationMs / 1000).toFixed(1)}s):`);
    lines.push('');
    lines.push('```');
    lines.push(r.answer.slice(0, 8000) || '(empty)');
    lines.push('```');
    lines.push('');
  }

  // Errored
  if (errored.length > 0) {
    lines.push('## Errors');
    lines.push('');
    for (const r of errored) {
      lines.push(`- ${r.id}: ${r.error}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  if (!flags.smoke && !flags.full) {
    console.error('Pass --smoke (10 scenarios, ~8min) or --full (all, ~40min).');
    process.exit(2);
  }
  if (flags.smoke && flags.full) {
    console.error('Pass either --smoke or --full, not both.');
    process.exit(2);
  }

  const apiBase = process.env.OMAHA_API_BASE_URL ?? 'http://localhost:3001';
  const email = process.env.DRAMA_CO_EMAIL ?? 'admin@drama-co.local';
  const password = process.env.DRAMA_CO_PASSWORD;
  const tenantSlug = process.env.DRAMA_CO_TENANT_SLUG ?? 'drama_co';
  const dbUrl = process.env.DATABASE_URL;

  if (!password) {
    console.error('DRAMA_CO_PASSWORD env var is required.');
    process.exit(2);
  }
  if (!dbUrl) {
    console.error('DATABASE_URL env var is required.');
    process.exit(2);
  }

  const mode = flags.smoke ? 'smoke' : 'full';
  const selected = flags.smoke ? scenarios.filter((s) => s.tags.includes('smoke')) : scenarios;
  console.log(`[start] mode=${mode} scenarios=${selected.length} api=${apiBase}`);

  console.log('[setup] logging in...');
  const token = await login(apiBase, email, password, tenantSlug);

  console.log('[setup] connecting to local Postgres for ground truth...');
  const pg = new Client({ connectionString: dbUrl });
  await pg.connect();

  const t0 = Date.now();
  const results: ScenarioResult[] = [];
  for (let i = 0; i < selected.length; i++) {
    const s = selected[i];
    const stepStart = Date.now();
    console.log(`[run] (${i + 1}/${selected.length}) ${s.id} — ${s.question.slice(0, 50)}...`);
    let answer = '';
    let groundTruth: unknown = null;
    let judgement: Judgement | { kind: 'human-review'; expectation: string };
    let error: string | undefined;
    try {
      groundTruth = await fetchGroundTruth(pg, s.ground);
      answer = await chat(apiBase, token, s.question);
      judgement = judge(answer, s.ground, groundTruth);
    } catch (err) {
      error = (err as Error)?.message ?? String(err);
      judgement = { kind: 'fail', reason: `error: ${error}` };
    }
    const durationMs = Date.now() - stepStart;
    results.push({ id: s.id, question: s.question, answer, durationMs, judgement, groundTruth, error });
    const tag =
      judgement.kind === 'pass' ? '✓'
        : judgement.kind === 'fail' ? '✗'
          : '?';
    console.log(`        ${tag} ${(durationMs / 1000).toFixed(1)}s`);
  }
  await pg.end();
  const elapsed = Date.now() - t0;

  const report = buildReport(results, elapsed, mode);

  const outDir = path.resolve(__dirname, 'test-results');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(outDir, `drama-agent-${mode}-${ts}.md`);
  fs.writeFileSync(outPath, report, 'utf8');

  console.log('');
  console.log(report);
  console.log(`\n[done] report written to ${outPath}`);

  // Non-zero exit if any auto-judged scenario failed
  const failed = results.some((r) => r.judgement.kind === 'fail');
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
