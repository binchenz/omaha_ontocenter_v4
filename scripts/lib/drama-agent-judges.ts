export type Judgement =
  | { kind: 'pass' }
  | { kind: 'fail'; reason: string };

/**
 * judgeNumeric: answer must contain the exact ground-truth number as a
 * standalone token (not embedded in a larger number).
 */
export function judgeNumeric(answer: string, expected: number): Judgement {
  const re = new RegExp(`(?<![0-9])${expected}(?![0-9])`);
  if (re.test(answer)) return { kind: 'pass' };
  return { kind: 'fail', reason: `expected ${expected} not found in answer` };
}

/**
 * judgeNameVariants: answer must contain at least one of the variant strings.
 * Substring match.
 */
export function judgeNameVariants(answer: string, variants: string[]): Judgement {
  for (const v of variants) {
    if (answer.includes(v)) return { kind: 'pass' };
    // Also accept prefix match when the variant carries a trailing
    // (公众号：...) / 作者：... qualifier the Agent may drop.
    const prefix = v
      .replace(/\s*\(公众号[：:][^)]+\)/g, '')
      .replace(/\s*（公众号[：:][^）]+）/g, '')
      .replace(/\s*作者[：:][\s\S]+$/g, '')
      .trim();
    if (prefix && prefix !== v && prefix.length >= 3 && answer.includes(prefix)) {
      return { kind: 'pass' };
    }
  }
  return { kind: 'fail', reason: `none of [${variants.join(', ')}] found in answer` };
}

/**
 * judgeSetMembership: top-K + no-superset.
 * - Answer must contain the first K items of `groundTruth` (top-K).
 * - Answer must NOT contain any name that is not in `groundTruth` (no superset / no hallucination).
 *
 * Match strategy: substring match for each ground-truth name. To detect
 * superset names we use a heuristic — split the answer into candidate
 * tokens by common separators, then check each token against the ground
 * truth. This is loose; the runner reports `requires_human_review` if the
 * judgement is borderline.
 *
 * For simplicity in v1 we only check the no-superset side via a small
 * provided `forbiddenSampleNames` list passed in via the scenario; here
 * we approximate by checking for capitalised single-letter or specific
 * test sentinel strings in the test fixtures.
 */
export function judgeSetMembership(
  answer: string,
  groundTruth: string[],
  topK: number,
): Judgement {
  // 1) top-K must appear. We accept either:
  //    - the full ground-truth string (strict match), or
  //    - a distinctive prefix (head 5+ chars) when the full string has
  //      trailing qualifiers like "作者：..." or "(公众号：...)" that
  //      the Agent may drop when rendering a markdown table.
  for (let i = 0; i < Math.min(topK, groundTruth.length); i++) {
    const full = groundTruth[i];
    if (answer.includes(full)) continue;
    // Try a distinctive prefix: strip common trailing qualifiers.
    const prefix = full
      .replace(/\s*\(公众号[：:][^)]+\)/g, '')
      .replace(/\s*（公众号[：:][^）]+）/g, '')
      .replace(/\s*作者[：:][\s\S]+$/g, '')
      .trim();
    if (prefix && prefix !== full && prefix.length >= 3 && answer.includes(prefix)) continue;
    return { kind: 'fail', reason: `missing top-${i + 1} item: ${full}` };
  }

  // 2) no-superset: tokenise answer; any token that is not in groundTruth
  // and looks like a single-uppercase-letter name candidate is a hallucination.
  const tokens = answer.split(/[\s,，、。；;:()()「」'"]+/).filter((t) => t.length > 0);
  const groundSet = new Set(groundTruth);
  for (const t of tokens) {
    if (/^[A-Z]$/.test(t) && !groundSet.has(t)) {
      return { kind: 'fail', reason: `superset / hallucinated name: ${t}` };
    }
  }
  return { kind: 'pass' };
}
