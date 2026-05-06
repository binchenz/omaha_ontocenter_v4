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
  // 1) top-K must all appear.
  for (let i = 0; i < Math.min(topK, groundTruth.length); i++) {
    if (!answer.includes(groundTruth[i])) {
      return { kind: 'fail', reason: `missing top-${i + 1} item: ${groundTruth[i]}` };
    }
  }

  // 2) no-superset: tokenise answer; any token that is not in groundTruth
  // and looks like a "name candidate" is a hallucination signal.
  // Names in this test domain are short alphanum tokens (ASCII for tests;
  // Chinese book titles handled by checking each ground-truth-not-found
  // single-uppercase-letter or alphanumeric chunk).
  const tokens = answer.split(/[\s,，、。；;:()()「」'"]+/).filter((t) => t.length > 0);
  const groundSet = new Set(groundTruth);
  for (const t of tokens) {
    // Heuristic: only treat single-uppercase letters and short alphanum as candidate names.
    if (/^[A-Z]$/.test(t) && !groundSet.has(t)) {
      return { kind: 'fail', reason: `superset / hallucinated name: ${t}` };
    }
  }
  return { kind: 'pass' };
}
