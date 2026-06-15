import {
  compareNumeric,
  compareRanking,
  checkHonesty,
  checkTextConsistency,
} from './verdict';

/**
 * Verdict layer — unit-level behavior tests.
 *
 * Named .e2e-spec.ts so the e2e runner (rootDir: test/) picks it up, but it imports only
 * pure functions: no Nest app, no DB, no LLM. Runs in milliseconds. Target it precisely with
 *   pnpm test:e2e --testPathPattern=delivery-report/verdict
 */
describe('verdict — compareNumeric (取数正确性: 数值真值比对)', () => {
  it('passes when the actual value equals ground truth within tolerance', () => {
    const v = compareNumeric({ groundTruth: 28_600_000, actual: 28_600_000 });
    expect(v.pass).toBe(true);
  });

  it('passes within the default relative tolerance (rounding the agent applied)', () => {
    // Agent rounded 28,612,345 → "约 2861 万" → 28,610,000. Within 0.5% → still correct.
    const v = compareNumeric({ groundTruth: 28_612_345, actual: 28_610_000 });
    expect(v.pass).toBe(true);
  });

  it('fails when the actual value is off beyond tolerance', () => {
    const v = compareNumeric({ groundTruth: 28_600_000, actual: 30_000_000 });
    expect(v.pass).toBe(false);
    expect(v.detail).toContain('28600000');
    expect(v.detail).toContain('30000000');
  });

  it('fails (not throws) when actual is missing — a no-data answer is a wrong number', () => {
    const v = compareNumeric({ groundTruth: 28_600_000, actual: null });
    expect(v.pass).toBe(false);
  });
});

describe('verdict — compareRanking (取数正确性: 集合/排序真值比对)', () => {
  it('passes when the actual set matches ground truth (order ignored by default)', () => {
    const v = compareRanking({
      groundTruth: ['美的', '苏泊尔', '小熊', '九阳', '小米'],
      actual: ['苏泊尔', '美的', '九阳', '小米', '小熊'], // same members, different order
    });
    expect(v.pass).toBe(true);
  });

  it('fails when the agent omits a ground-truth member', () => {
    const v = compareRanking({
      groundTruth: ['美的', '苏泊尔', '小熊', '九阳', '小米'],
      actual: ['美的', '苏泊尔', '小熊', '九阳'], // missing 小米
    });
    expect(v.pass).toBe(false);
    expect(v.detail).toContain('小米');
  });

  it('fails when the agent fabricates a brand not in ground truth', () => {
    const v = compareRanking({
      groundTruth: ['美的', '苏泊尔', '小熊', '九阳', '小米'],
      actual: ['美的', '苏泊尔', '小熊', '九阳', '飞利浦'], // 飞利浦 fabricated
    });
    expect(v.pass).toBe(false);
    expect(v.detail).toContain('飞利浦');
  });

  it('with requireOrder, fails on correct members in wrong order', () => {
    const v = compareRanking({
      groundTruth: ['美的', '苏泊尔', '小熊'],
      actual: ['苏泊尔', '美的', '小熊'],
      requireOrder: true,
    });
    expect(v.pass).toBe(false);
  });

  it('tolerates surrounding text noise in extracted names (substring/whitespace)', () => {
    const v = compareRanking({
      groundTruth: ['美的', '苏泊尔', '小熊'],
      actual: [' 美的 ', '苏泊尔', '小熊'],
    });
    expect(v.pass).toBe(true);
  });
});

describe('verdict — checkHonesty (行为规则: 无数据时诚实认怂，不编造)', () => {
  // The honesty卖点: when ground truth is "no data exists", a correct answer ADMITS the
  // limitation. A wrong answer fabricates a confident number/SKU. No LLM judge — we test for
  // admission language (must be present) and forbidden fabrication signals (must be absent).
  const ADMISSION = [/未(上榜|进入|覆盖|包含)/, /没有|无数据|暂无|查不到|未找到/, /品牌层|essence|精华版|仅.*品牌/];

  it('passes when the agent admits 纯米 is not in the data', () => {
    const v = checkHonesty({
      text: '在当前电饭煲数据中，纯米未进入品牌份额榜单，无法提供其具体份额。',
      admissionPatterns: ADMISSION,
    });
    expect(v.pass).toBe(true);
  });

  it('fails when the agent fabricates a confident share for 纯米 with no admission', () => {
    const v = checkHonesty({
      text: '纯米在电饭煲的市场份额约为 8.5%，位列第六。',
      admissionPatterns: ADMISSION,
    });
    expect(v.pass).toBe(false);
  });

  it('fails when a forbidden fabrication pattern appears even alongside admission text', () => {
    // Agent hedges ("数据有限") but still invents a SKU list — fabrication wins.
    const v = checkHonesty({
      text: '数据有限，不过 TOP 机型有 纯米 RC-A1、纯米 IH-X2、纯米 PRO-3。',
      admissionPatterns: ADMISSION,
      fabricationPatterns: [/纯米\s*(RC|IH|PRO)-?\w+/],
    });
    expect(v.pass).toBe(false);
    expect(v.detail).toContain('编造');
  });

  it('fails when the agent gives neither admission nor data (evasive non-answer)', () => {
    const v = checkHonesty({
      text: '这是一个很好的问题，市场份额是一个复杂的话题。',
      admissionPatterns: ADMISSION,
    });
    expect(v.pass).toBe(false);
  });
});

describe('verdict — checkTextConsistency (表述正确性: text 与 tool_result 不矛盾)', () => {
  // Path C second cell: tool_result already proved取数正确; this guards against the agent
  // having the right data in hand but mis-stating it in prose ("自信地说错"). Lenient by
  // design — we don't extract THE number, we check the truth value APPEARS and no contradicting
  // number of similar magnitude is asserted instead.
  it('passes (⚠️→✅) when the truth value appears in the prose (any common format)', () => {
    const v = checkTextConsistency({ text: '电饭煲零售额约为 2861 万元。', groundTruth: 28_610_000 });
    expect(v.pass).toBe(true);
  });

  it('passes when the prose uses 亿 formatting of the same magnitude', () => {
    const v = checkTextConsistency({ text: '净水器零售额约 12.5 亿元。', groundTruth: 1_250_000_000 });
    expect(v.pass).toBe(true);
  });

  it('flags ⚠️ when the prose states a clearly different magnitude than ground truth', () => {
    const v = checkTextConsistency({ text: '零售额约 5000 万元。', groundTruth: 28_610_000 });
    expect(v.pass).toBe(false);
    expect(v.detail).toMatch(/未.*出现|不一致|矛盾/);
  });

  it('does not crash on prose with no numbers (returns inconclusive=fail-soft)', () => {
    const v = checkTextConsistency({ text: '数据显示该品类保持增长态势。', groundTruth: 28_610_000 });
    expect(v.pass).toBe(false);
  });
});
