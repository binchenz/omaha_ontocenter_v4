import { renderReport, ScenarioResult, ReportWriter } from './report';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Report renderer — pure function: scenario results → markdown for 纯米. Unit-tested with
 * synthetic results (no DB, no LLM). Asserts the delivery-facing structure: 6-category sections,
 * per-scenario two-cell verdict (取数/表述 or 行为), N-run pass rate, and a summary table.
 */
function fakeResults(): ScenarioResult[] {
  return [
    {
      id: 'MKT-1', category: '市场大盘体检', difficulty: 'L1', track: 'fact',
      question: '电饭煲 22.12 的零售额是多少？',
      runs: 3, passes: 3,
      sampleAnswer: '电饭煲 22.12 零售额约 28.6 亿元。',
      verdict: {
        dataCorrect: { pass: true, detail: '期望 2860000000，实际 2860000000（相对误差 0.00%）' },
        statementCorrect: { pass: true, detail: '表述中的数值与真值一致' },
      },
    },
    {
      id: 'CHM-1', category: '纯米自家定位', difficulty: 'L3', track: 'behavior',
      question: '纯米在电饭煲 22.12 的市场份额是多少？',
      runs: 3, passes: 2,
      sampleAnswer: '纯米未进入电饭煲品牌份额榜单，无法提供其具体份额。',
      verdict: {
        behaviorCorrect: { pass: true, detail: '已诚实说明数据限制（未编造）' },
      },
    },
  ];
}

describe('report — markdown rendering', () => {
  const md = renderReport({
    title: '纯米 AVC 市场智能平台 — Agent 效果验收报告',
    generatedAt: '2026-06-15',
    tenant: '纯米科技',
    dataScope: '电饭煲单品类 · 22.12',
    results: fakeResults(),
  });

  it('includes a title and generation metadata', () => {
    expect(md).toContain('纯米 AVC 市场智能平台');
    expect(md).toContain('2026-06-15');
    expect(md).toContain('纯米科技');
  });

  it('renders a section per business category present in results', () => {
    expect(md).toContain('市场大盘体检');
    expect(md).toContain('纯米自家定位');
  });

  it('shows each scenario question and a sample answer', () => {
    expect(md).toContain('电饭煲 22.12 的零售额是多少？');
    expect(md).toContain('未进入电饭煲品牌份额榜单');
  });

  it('shows the two-cell verdict for a fact scenario (取数 + 表述)', () => {
    expect(md).toContain('取数正确性');
    expect(md).toContain('表述正确性');
  });

  it('shows behavior verdict for a behavior scenario', () => {
    expect(md).toContain('行为正确性');
  });

  it('shows N-run pass rate per scenario', () => {
    expect(md).toMatch(/3\s*\/\s*3|100%/); // MKT-1 passed 3/3
    expect(md).toMatch(/2\s*\/\s*3|67%/);  // CHM-1 passed 2/3
  });

  it('ends with a summary table aggregating pass rates', () => {
    expect(md.toLowerCase()).toContain('汇总');
    // overall pass rate across 6 total runs (5 passes) appears
    expect(md).toMatch(/总通过率|整体通过率/);
  });

  it('uses ✅ / ❌ marks so a non-technical reader can scan verdicts', () => {
    expect(md).toContain('✅');
  });
});

describe('ReportWriter — incremental persistence (#198)', () => {
  // The jest e2e rendered the report ONLY after the full loop, so a single hanging scenario
  // (CHM-3 spiraled past timeout) crashed the run and lost every completed scenario. The writer
  // persists after each scenario, so a later crash leaves a valid partial report on disk.
  let dir: string;
  let outPath: string;
  const meta = { title: 'T', generatedAt: '2026-06-16', tenant: '纯米科技', dataScope: '电饭煲' };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-writer-'));
    outPath = path.join(dir, 'r.md');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('writes a valid report file after the first scenario, before any later scenario runs', () => {
    const w = new ReportWriter(outPath, meta);
    w.add(fakeResults()[0]); // MKT-1 only
    expect(fs.existsSync(outPath)).toBe(true);
    const md1 = fs.readFileSync(outPath, 'utf-8');
    expect(md1).toContain('MKT-1');
    expect(md1).toContain('电饭煲 22.12 的零售额是多少？');
  });

  it('a crash after N scenarios leaves those N on disk (partial survives)', () => {
    const w = new ReportWriter(outPath, meta);
    w.add(fakeResults()[0]);
    w.add(fakeResults()[1]);
    // simulate crash: no finalize() call
    const md = fs.readFileSync(outPath, 'utf-8');
    expect(md).toContain('MKT-1');
    expect(md).toContain('CHM-1');
    expect(md).toContain('汇总'); // still a coherent, summarized document
  });
});
