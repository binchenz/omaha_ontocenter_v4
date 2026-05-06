export interface CandidateCharacter {
  id: string;
  name: string;
}

function stripParen(s: string): string {
  return s.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '').trim();
}

function primaryName(s: string): string {
  return s.split('·')[0].trim();
}

function normalize(s: string): string[] {
  const variants = new Set<string>();
  const trimmed = s.trim();
  if (!trimmed) return [];
  variants.add(trimmed);
  const noParen = stripParen(trimmed);
  if (noParen) variants.add(noParen);
  const primary = primaryName(noParen || trimmed);
  if (primary) variants.add(primary);
  return Array.from(variants);
}

export function resolveCharacterName(
  input: string,
  candidates: CandidateCharacter[],
): string | null {
  if (!input || !input.trim()) return null;
  if (candidates.length === 0) return null;

  const inputVariants = normalize(input);
  const candidateVariantsById = new Map<string, string[]>();
  for (const c of candidates) {
    candidateVariantsById.set(c.id, normalize(c.name));
  }

  const exactMatches = candidates.filter((c) => c.name === input.trim());
  if (exactMatches.length === 1) return exactMatches[0].id;
  if (exactMatches.length > 1) return null;

  for (const variant of inputVariants) {
    const matches = candidates.filter((c) =>
      (candidateVariantsById.get(c.id) ?? []).includes(variant),
    );
    if (matches.length === 1) return matches[0].id;
    if (matches.length > 1) return null;
  }

  return null;
}
