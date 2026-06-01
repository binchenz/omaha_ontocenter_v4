/**
 * The shared 品类 (category) + 价格段 (price band) spine (ADR-0042 §3). The single
 * coupling point between the two market-intelligence ingestion paths: AVC structured
 * metrics and research-document chunks both classify by 品类 (and where present 价格段)
 * declared at ingest, so a fused query can join a narrative finding to a market number
 * without entity extraction. Pure functions — no DB, no request context — imported by
 * both ingestion paths so they cannot disagree on the join keys.
 */

/** Canonical small-appliance 品类 the platform recognises (the AVC/research archive set). */
const CANONICAL_CATEGORIES: readonly string[] = [
  '电饭煲',
  '空气炸锅',
  '净水器',
  '净饮机',
  '食品料理机',
  '电磁炉',
  '电压力锅',
  '电水壶',
  '养生壶',
  '微波炉',
  '电烤箱',
  '煎烤机',
];

/**
 * Aliases that name a canonical category by a different word. AVC files the 破壁机 sheet
 * under 食品料理机; both are the same category.
 */
const CATEGORY_ALIASES: Readonly<Record<string, string>> = {
  破壁机: '食品料理机',
  料理机: '食品料理机',
};

const CANONICAL_SET = new Set(CANONICAL_CATEGORIES);

/** Strip leading/trailing ASCII and full-width (U+3000) whitespace. */
function trimWide(raw: string): string {
  return raw.replace(/^[\s　]+|[\s　]+$/g, '');
}

/**
 * Map a raw category string (filename fragment, sheet name, declared metadata) to its
 * canonical 品类, or `null` if it is not in the recognised set — the unjoinable-island
 * guard (ADR-0042 §3, PRD #96 story 30): an unknown category is flagged, never silently
 * accepted, so it cannot create chunks/metrics that join to nothing.
 */
export function normalizeCategory(raw: string): string | null {
  const trimmed = trimWide(raw);
  if (!trimmed) return null;
  if (CANONICAL_SET.has(trimmed)) return trimmed;
  return CATEGORY_ALIASES[trimmed] ?? null;
}

export interface PriceBand {
  /** Inclusive lower bound; `0` for an open-ended lower band (≤ / <). */
  min: number;
  /** Inclusive upper bound; `null` for an open-ended upper band (≥ / +). */
  max: number | null;
}

const FULLWIDTH_DIGIT_OFFSET = '０'.charCodeAt(0) - '0'.charCodeAt(0);

/** Normalise full-width digits → ASCII and the full-width tilde → '-'. */
function normalizeBandText(raw: string): string {
  return trimWide(raw)
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - FULLWIDTH_DIGIT_OFFSET))
    .replace(/[～~]/g, '-');
}

/**
 * Parse a price-band label into a comparable `[min, max]` range. AVC and the research
 * PDFs use *different* band segmentations (e.g. AVC `400-500` vs PDF `400-699`), so we
 * deliberately do NOT reconcile to one canonical set (ADR-0042) — each label is parsed
 * literally into a range the caller can compare. Returns `null` for the overall/total
 * column (整体) and any non-band text, so grid parsing can skip those columns.
 */
export function parsePriceBand(raw: string): PriceBand | null {
  const text = normalizeBandText(raw);
  if (!text) return null;

  // Open-ended upper: ≥N, >=N, N+, >N
  let m = /^(?:≥|>=|>)\s*(\d+)$/.exec(text) ?? /^(\d+)\s*\+$/.exec(text);
  if (m) return { min: Number(m[1]), max: null };

  // Open-ended lower (from a zero floor): ≤N, <=N, <N
  m = /^(?:≤|<=|<)\s*(\d+)$/.exec(text);
  if (m) return { min: 0, max: Number(m[1]) };

  // Closed range: N-M
  m = /^(\d+)\s*-\s*(\d+)$/.exec(text);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };

  return null;
}
