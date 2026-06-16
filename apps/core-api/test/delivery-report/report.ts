import type { BusinessCategory, ScenarioVerdict } from './scenarios';
import { writeFileSync } from 'fs';

/** One scenario's outcome over an N-run, ready to render. */
export interface ScenarioResult {
  id: string;
  category: BusinessCategory;
  difficulty: string;
  track: 'fact' | 'behavior';
  question: string;
  runs: number;
  passes: number;
  /** A representative agent answer to show the reader what the response looked like. */
  sampleAnswer: string;
  /** Verdict from the best (or representative) run. */
  verdict: ScenarioVerdict;
}

export interface ReportInput {
  title: string;
  generatedAt: string;
  tenant: string;
  dataScope: string;
  results: ScenarioResult[];
}

const CATEGORY_ORDER: BusinessCategory[] = [
  '市场大盘体检', '品牌竞争格局', '纯米自家定位', '价格段攻防', '机型级洞察', '知识边界诚实', '趋势分析',
];

const CATEGORY_BLURB: Record<BusinessCategory, string> = {
  市场大盘体检: '回答品类整体的零售额/量/均价等大盘指标——分析师每天的第一个问题。',
  品牌竞争格局: '回答品牌份额排名与竞争位次——看清谁在领跑。',
  纯米自家定位: '当纯米尚未进入某品类数据时，验证 Agent 是否诚实认怂、绝不编造份额。',
  价格段攻防: '在指定价格段内的品牌份额格局——高端攻防的核心视角。',
  机型级洞察: '下钻到单机型的销额份额排名——从品牌层穿透到 SKU。',
  知识边界诚实: '面对数据没有覆盖的问题，验证 Agent 守住边界、不臆造答案。',
  趋势分析: '跨时间维度的走势判断——大盘趋势、品牌兴衰、跨品类对比。',
};

function pct(passes: number, runs: number): string {
  if (runs === 0) return 'N/A';
  return `${Math.round((passes / runs) * 100)}%`;
}

function rateCell(passes: number, runs: number): string {
  const mark = passes === runs ? '✅' : passes === 0 ? '❌' : '⚠️';
  return `${mark} ${passes}/${runs}（${pct(passes, runs)}）`;
}

function verdictMark(pass: boolean | undefined): string {
  return pass === true ? '✅' : pass === false ? '❌' : '—';
}

/** Render the full delivery report as markdown. Pure function — no IO. */
export function renderReport(input: ReportInput): string {
  const lines: string[] = [];

  lines.push(`# ${input.title}`, '');
  lines.push(`- **生成时间**：${input.generatedAt}`);
  lines.push(`- **租户**：${input.tenant}`);
  lines.push(`- **数据范围**：${input.dataScope}`);
  lines.push('');
  lines.push(
    '> 本报告中每个事实型问题的"正确"由独立 SQL 真值比对判定（取数正确性），',
    '> 并校验回答表述与真值不矛盾（表述正确性）；行为型问题（如数据未覆盖时是否诚实）由行为规则判定。',
    '> 全程不使用"AI 给 AI 打分"，判词均可复核。',
    '',
  );

  // Per-category sections
  for (const category of CATEGORY_ORDER) {
    const rows = input.results.filter((r) => r.category === category);
    if (rows.length === 0) continue;
    lines.push(`## ${category}`, '');
    lines.push(`_${CATEGORY_BLURB[category]}_`, '');

    for (const r of rows) {
      lines.push(`### ${r.id} · ${r.question}`, '');
      lines.push(`- **难度**：${r.difficulty}　**通过率（N-run）**：${rateCell(r.passes, r.runs)}`);
      if (r.track === 'fact') {
        lines.push(
          `- **取数正确性**：${verdictMark(r.verdict.dataCorrect?.pass)} ${r.verdict.dataCorrect?.detail ?? ''}`,
        );
        lines.push(
          `- **表述正确性**：${verdictMark(r.verdict.statementCorrect?.pass)} ${r.verdict.statementCorrect?.detail ?? ''}`,
        );
      } else {
        lines.push(
          `- **行为正确性**：${verdictMark(r.verdict.behaviorCorrect?.pass)} ${r.verdict.behaviorCorrect?.detail ?? ''}`,
        );
      }
      lines.push(`- **回答摘录**：${r.sampleAnswer}`);
      lines.push('');
    }
  }

  // Summary table
  lines.push('## 汇总', '');
  lines.push('| 业务类别 | 场景数 | 通过率 |');
  lines.push('| --- | --- | --- |');
  let totalRuns = 0, totalPasses = 0;
  for (const category of CATEGORY_ORDER) {
    const rows = input.results.filter((r) => r.category === category);
    if (rows.length === 0) continue;
    const runs = rows.reduce((a, r) => a + r.runs, 0);
    const passes = rows.reduce((a, r) => a + r.passes, 0);
    totalRuns += runs; totalPasses += passes;
    lines.push(`| ${category} | ${rows.length} | ${rateCell(passes, runs)} |`);
  }
  lines.push('');
  lines.push(`**总通过率**：${rateCell(totalPasses, totalRuns)}（共 ${input.results.length} 个场景，${totalRuns} 次运行）`);
  lines.push('');

  return lines.join('\n');
}

/**
 * #198 — incremental report persistence. The e2e used to render only after the full scenario
 * loop, so one hanging scenario (CHM-3 spiraled past timeout) crashed the run and lost every
 * completed result. ReportWriter re-renders and writes the file after each scenario is added, so
 * a later crash leaves a valid, summarized partial report on disk. `renderReport` is pure and
 * accepts a partial results array, so a partial render is always a coherent document.
 */
export class ReportWriter {
  private readonly results: ScenarioResult[] = [];

  constructor(
    private readonly outPath: string,
    private readonly meta: Omit<ReportInput, 'results'>,
  ) {}

  /** Where the report is being written — for logging after the run. */
  get path(): string {
    return this.outPath;
  }

  /** Append one scenario's result and immediately re-render + persist the whole report so far. */
  add(result: ScenarioResult): void {
    this.results.push(result);
    writeFileSync(this.outPath, renderReport({ ...this.meta, results: this.results }), 'utf-8');
  }
}
