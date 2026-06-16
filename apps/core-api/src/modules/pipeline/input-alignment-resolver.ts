/**
 * One ready Dataset version of a declared input, as seen by the trigger. `alignKeyValue` is the
 * batch key (e.g. "2026-06" for reportMonth) when the source can supply one; absent otherwise.
 */
export interface ReadyVersion {
  datasetId: string;
  alignKeyValue?: string;
}

export interface AlignmentResult {
  /** Whether all declared inputs are satisfied and a PipelineRun should fire now. */
  fire: boolean;
  /** Chosen input version per declared input name (only meaningful when fire is true). */
  chosenVersions: Record<string, string>;
}

/**
 * InputAlignmentResolver — model 1′ (ADR-0060 #5). Pure, IO-free. Decides whether a multi-input
 * Pipeline should fire and which input versions to join, given the ready versions currently
 * available per declared input. This is the guardrail against fact×fact cross-batch mis-pairing.
 *
 * Decision matrix:
 *  - any declared input has no ready version            → do NOT fire.
 *  - all ready, no alignKey                             → fire with the latest ready version of each
 *                                                         input (correct for single-input and
 *                                                         fact×slow-dimension).
 *  - all ready, alignKey, a value present in every input → fire, joining only that same-key version.
 *  - alignKey but no value is present across every input → do NOT fire (6-月 orders never pairs with
 *                                                          5-月 refunds — the core defense).
 */
export function resolveInputAlignment(
  declaredInputs: string[],
  readyVersionsByInput: Record<string, ReadyVersion[]>,
  alignKey?: string,
): AlignmentResult {
  const empty: AlignmentResult = { fire: false, chosenVersions: {} };

  // All-ready gate: every declared input must have at least one ready version.
  for (const name of declaredInputs) {
    const versions = readyVersionsByInput[name] ?? [];
    if (versions.length === 0) return empty;
  }

  // Default (no alignKey): latest ready version of each input. Correct for single-input and
  // fact×slow-changing-dimension, where "latest of each" is exactly the intended pairing.
  if (!alignKey) {
    const chosenVersions: Record<string, string> = {};
    for (const name of declaredInputs) {
      chosenVersions[name] = latest(readyVersionsByInput[name]).datasetId;
    }
    return { fire: true, chosenVersions };
  }

  // alignKey set: fire only on a batch key present in EVERY input, joining just that key's versions.
  // This is the guardrail — 6-月 orders never pairs with 5-月 refunds. Among keys shared by all
  // inputs, pick the newest (latest-first scan), so a fresh aligned batch supersedes older ones.
  const keysPerInput = declaredInputs.map((name) =>
    new Set(
      (readyVersionsByInput[name] ?? [])
        .map((v) => v.alignKeyValue)
        .filter((k): k is string => k !== undefined),
    ),
  );
  const sharedKeys = [...keysPerInput[0]].filter((k) => keysPerInput.every((set) => set.has(k)));
  if (sharedKeys.length === 0) return empty;
  const chosenKey = sharedKeys.sort().reverse()[0]; // newest shared batch key

  const chosenVersions: Record<string, string> = {};
  for (const name of declaredInputs) {
    // The latest ready version carrying the chosen key (defensive: same key, newest landing).
    const match = latest((readyVersionsByInput[name] ?? []).filter((v) => v.alignKeyValue === chosenKey));
    chosenVersions[name] = match.datasetId;
  }
  return { fire: true, chosenVersions };
}

/** The latest ready version — last in the list (callers pass versions oldest→newest). */
function latest(versions: ReadyVersion[]): ReadyVersion {
  return versions[versions.length - 1];
}
