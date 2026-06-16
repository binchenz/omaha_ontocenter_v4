/**
 * Goal-2 trace auditor — offline analysis of LLM_DEBUG dumps from a strategic-analyst eval run.
 *
 * Reads every .llm-debug/<dir>/*.json round-trip dump and reports, per round and in aggregate:
 *   - prompt tokens (the cost), system-prompt section sizes (which prose burns budget),
 *   - the tool_call the model emitted that round (the toolcall sequence / convergence),
 *   - latency.
 * This is the evidence base for "prompt/toolcall 是否有可优化空间" — it does NOT hit the LLM.
 *
 *   node -r ts-node/register scripts/audit-llm-trace.ts .llm-debug/strategic
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const dir = process.argv[2] ?? '.llm-debug/strategic';

interface Dump {
  request: { model: string; messages: Array<{ role: string; content?: string; tool_calls?: any[] }>; tools: any[] };
  response: any;
  durationMs: number;
  promptTokens: number;
}

/** Split a system prompt into its assembled sections by the known headers (orchestrator.buildSystemPrompt). */
function sectionize(sys: string): Array<{ name: string; chars: number }> {
  // Sections are joined by \n\n; identify by leading marker.
  const markers: Array<[string, RegExp]> = [
    ['base 安全规则', /^你是一个本体数据平台/],
    ['guidance 能力警告', /^(以下能力|注意：|当前会话)/],
    ['schema 数据模型', /^数据模型：/],
    ['tenantProfile 已导入数据', /^本租户已导入数据/],
    ['skill: 查询能力', /^## 查询能力/],
    ['skill: 调研洞察问答', /^## 调研洞察问答能力/],
  ];
  const blocks = sys.split('\n\n');
  const out: Array<{ name: string; chars: number }> = [];
  let current = 'base 安全规则';
  let buf = '';
  const flush = () => { if (buf) out.push({ name: current, chars: buf.length }); buf = ''; };
  for (const b of blocks) {
    const hit = markers.find(([, re]) => re.test(b));
    if (hit) { flush(); current = hit[0]; }
    buf += (buf ? '\n\n' : '') + b;
  }
  flush();
  return out;
}

function toolCallSummary(msg: { tool_calls?: any[] }): string {
  if (!msg.tool_calls?.length) return '(no tool_call — final answer)';
  return msg.tool_calls.map((tc) => {
    const fn = tc.function?.name ?? tc.name;
    let args: any = {};
    try { args = JSON.parse(tc.function?.arguments ?? '{}'); } catch {}
    const ot = args.objectType ? `(${args.objectType})` : '';
    const f = (args.filters ?? []).map((x: any) => `${x.field}${x.operator ?? '='}${JSON.stringify(x.value)}`).join(' ');
    const g = (args.groupBy ?? []).join(',');
    const m = (args.metrics ?? []).map((x: any) => `${x.kind}(${x.field ?? '*'})`).join(',');
    return `${fn}${ot} filters:[${f}] groupBy:[${g}] metrics:[${m}]`;
  }).join(' ; ');
}

function main() {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (!files.length) { console.error(`no dumps in ${dir}`); process.exit(1); }

  let totalTokens = 0, totalMs = 0;
  let sectionsOnce: Array<{ name: string; chars: number }> | null = null;
  console.log(`\n📊 Goal-2 trace audit — ${files.length} LLM round-trips in ${dir}\n${'─'.repeat(90)}`);
  files.forEach((f, i) => {
    const d: Dump = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const sys = d.request.messages.find((m) => m.role === 'system')?.content ?? '';
    const userMsgs = d.request.messages.filter((m) => m.role === 'user').length;
    const assistantMsg = d.response?.choices?.[0]?.message ?? d.response?.message ?? {};
    totalTokens += d.promptTokens ?? 0;
    totalMs += d.durationMs ?? 0;
    if (!sectionsOnce && sys) sectionsOnce = sectionize(sys);
    console.log(
      `#${String(i + 1).padStart(2)} promptTok=${String(d.promptTokens).padStart(5)} ${String(d.durationMs).padStart(6)}ms ` +
      `msgs=${d.request.messages.length}(user=${userMsgs}) → ${toolCallSummary(assistantMsg)}`,
    );
  });

  console.log(`\n${'─'.repeat(90)}\n累计 promptTokens=${totalTokens}（注意：多轮会话每轮都重发完整 system+history，token 随轮数线性累加）`);
  console.log(`累计 LLM 墙钟=${(totalMs / 1000).toFixed(1)}s，平均每轮 ${(totalMs / files.length / 1000).toFixed(1)}s`);

  if (sectionsOnce) {
    const secs = sectionsOnce as Array<{ name: string; chars: number }>;
    const sysTotal = secs.reduce((a, b) => a + b.chars, 0);
    console.log(`\n系统提示词分段构成（首轮，共 ${sysTotal} chars ≈ ${Math.round(sysTotal / 1.7)} tokens 估算）：`);
    for (const s of secs.sort((a, b) => b.chars - a.chars)) {
      const pctBar = '█'.repeat(Math.round((s.chars / sysTotal) * 40));
      console.log(`  ${String(s.chars).padStart(5)} chars ${((s.chars / sysTotal) * 100).toFixed(0).padStart(3)}%  ${pctBar} ${s.name}`);
    }
  }
}

main();
