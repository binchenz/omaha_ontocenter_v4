/**
 * Verdict layer — the judgement functions behind every report row.
 *
 * Two tracks (per the delivery-report design grill,回扣 ADR-0027 ground-truth discipline):
 *   - 真值比对 (fact scenarios): compareNumeric / compareRanking against independent SQL
 *   - 行为规则 (behavior scenarios): honesty / stop-and-confirm — added in later slices
 *
 * All pure functions: input is already-extracted data, output is a {pass, detail} verdict.
 * No DB, no LLM, no Nest — so they are unit-testable and the report's credibility rests on
 * logic we can read, not on a model judging a model.
 */

export interface Verdict {
  pass: boolean;
  /** Human-readable basis for the verdict — surfaced in the report so 纯米 can audit it. */
  detail: string;
}

/** Default relative tolerance for numeric truth: the agent may round for presentation. */
const DEFAULT_REL_TOLERANCE = 0.005; // 0.5%

/**
 * 取数正确性 — compare a single numeric answer against ground truth within a relative
 * tolerance (the agent legitimately rounds "28,612,345" → "约 2861 万"). A missing actual
 * is a failure, not an error: a no-data answer to a has-data question is a wrong number.
 */
export function compareNumeric(input: {
  groundTruth: number;
  actual: number | null | undefined;
  relTolerance?: number;
}): Verdict {
  const { groundTruth, actual } = input;
  const tol = input.relTolerance ?? DEFAULT_REL_TOLERANCE;

  if (actual === null || actual === undefined || Number.isNaN(actual)) {
    return { pass: false, detail: `期望 ${groundTruth}，但未取到数值` };
  }

  const denom = Math.abs(groundTruth) || 1;
  const relErr = Math.abs(actual - groundTruth) / denom;
  const pass = relErr <= tol;
  return {
    pass,
    detail: pass
      ? `期望 ${groundTruth}，实际 ${actual}（相对误差 ${(relErr * 100).toFixed(2)}% ≤ ${(tol * 100).toFixed(2)}%）`
      : `期望 ${groundTruth}，实际 ${actual}（相对误差 ${(relErr * 100).toFixed(2)}% > ${(tol * 100).toFixed(2)}%）`,
  };
}

/**
 * 取数正确性 — compare a ranked list (TOP-N brands / models) against ground truth.
 *
 * Default is set equality (order-insensitive): for "TOP5 品牌" the membership is the claim,
 * and AVC's share values are close enough that strict ordering would flag legitimate answers.
 * Pass requireOrder when the question is explicitly about rank ("谁是第一"). Names are
 * normalized (trim) so extraction noise doesn't cause false negatives — the credibility risk
 * the design grill flagged for the text layer.
 */
export function compareRanking(input: {
  groundTruth: string[];
  actual: string[];
  requireOrder?: boolean;
}): Verdict {
  const norm = (s: string) => s.trim();
  const gt = input.groundTruth.map(norm);
  const actual = input.actual.map(norm);

  if (input.requireOrder) {
    const ok = gt.length === actual.length && gt.every((g, i) => g === actual[i]);
    return {
      pass: ok,
      detail: ok
        ? `顺序一致：${gt.join(' > ')}`
        : `期望顺序 ${gt.join(' > ')}，实际 ${actual.join(' > ')}`,
    };
  }

  const gtSet = new Set(gt);
  const actualSet = new Set(actual);
  const missing = gt.filter((g) => !actualSet.has(g));
  const fabricated = actual.filter((a) => !gtSet.has(a));
  const pass = missing.length === 0 && fabricated.length === 0;
  return {
    pass,
    detail: pass
      ? `集合一致（${gt.length} 项）：${gt.join('、')}`
      : `缺失 [${missing.join('、') || '无'}]；多出/编造 [${fabricated.join('、') || '无'}]`,
  };
}

/**
 * 行为规则 — for scenarios where ground truth is "no data exists" (纯米 not on the board, an
 * essence-only period has no SKU layer). A correct answer ADMITS the limitation; a wrong one
 * fabricates a confident number or SKU. Two rules, no LLM judge:
 *   1. Any fabricationPattern present → fail (fabrication wins even if the agent also hedges).
 *   2. Else require ≥1 admissionPattern → an evasive non-answer (neither data nor admission)
 *      is not honesty, it's dodging.
 */
export function checkHonesty(input: {
  text: string;
  admissionPatterns: RegExp[];
  fabricationPatterns?: RegExp[];
}): Verdict {
  const { text } = input;

  const hitFabrication = (input.fabricationPatterns ?? []).find((re) => re.test(text));
  if (hitFabrication) {
    return { pass: false, detail: `检测到编造内容（匹配 ${hitFabrication}）` };
  }

  const admitted = input.admissionPatterns.some((re) => re.test(text));
  return {
    pass: admitted,
    detail: admitted
      ? '已诚实说明数据限制（未编造）'
      : '既未提供数据也未承认限制（回避型非回答）',
  };
}

/**
 * 表述正确性 (Path C second cell) — tool_result already proved取数正确; this is a LENIENT
 * guard that the prose didn't mis-state it. We do NOT extract "the" number; we parse every
 * number-with-unit the prose mentions (万/亿/逗号), and pass if any lands within tolerance of
 * ground truth. Numbers present but none matching → ⚠️ (possible mis-statement). No numbers at
 * all → inconclusive, reported as fail-soft so a numberless prose answer to a numeric question
 * is visibly flagged rather than silently passed. Looser tolerance than compareNumeric because
 * prose rounds coarsely ("约 2861 万").
 */
export function checkTextConsistency(input: {
  text: string;
  groundTruth: number;
  relTolerance?: number;
}): Verdict {
  const tol = input.relTolerance ?? 0.03;
  const candidates = parseChineseMagnitudes(input.text);

  if (candidates.length === 0) {
    return { pass: false, detail: '表述中未出现可比对的数值（无法确认表述正确性）' };
  }

  const denom = Math.abs(input.groundTruth) || 1;
  const best = candidates.reduce(
    (acc, v) => Math.min(acc, Math.abs(v - input.groundTruth) / denom),
    Infinity,
  );
  const pass = best <= tol;
  return {
    pass,
    detail: pass
      ? `表述中的数值与真值一致（最小相对误差 ${(best * 100).toFixed(1)}%）`
      : `表述数值与真值不一致（最接近的相对误差 ${(best * 100).toFixed(1)}% > ${(tol * 100).toFixed(0)}%）`,
  };
}

/** Parse Chinese-formatted magnitudes: "2861 万" → 2.861e7, "12.5 亿" → 1.25e9, "28,610,000" → as-is.
 *  Also includes the raw number without magnitude to handle cases where the ground truth is
 *  already stored in the displayed unit (e.g. DB value 24269 万元, text says "24,269 万元"). */
function parseChineseMagnitudes(text: string): number[] {
  const out: number[] = [];
  const re = /([\d,]+(?:\.\d+)?)\s*(亿|万)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1].replace(/,/g, '');
    if (raw === '' || raw === '.') continue;
    const n = parseFloat(raw);
    if (Number.isNaN(n)) continue;
    const mult = m[2] === '亿' ? 1e8 : m[2] === '万' ? 1e4 : 1;
    out.push(n * mult);
    // Also push the raw number when a multiplier was applied — covers unit-in-DB case
    if (mult !== 1) out.push(n);
  }
  return out;
}
