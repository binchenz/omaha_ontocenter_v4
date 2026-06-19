import type { Additivity, MeasureCell } from '@omaha/shared-types';

/**
 * The semantic hints a measure value carries into the formatter. Supplied by the
 * envelope assembler (which derives them from the query's metric/field), NOT by
 * the LLM. Keeping the rule keyed on a small explicit hint set — rather than
 * sniffing the number — means order-of-magnitude correctness is decided by code.
 */
export interface MeasureFormatHints {
  /** The unit `raw` is stored in: '万元' / '万台' / '元' / '%' / '' (unitless count). */
  unit?: string;
  /** The metric name to stamp on the cell (e.g. '零售额'); falls back to the alias. */
  metric?: string;
  /** ADR-0061 §1 additivity; defaults to 'additive' (the safe default for a plain measure). */
  additivity?: Additivity;
  /** ADR-0061 §2 sampling universe of the source star, when declared. */
  universe?: string;
  /** ADR-0064 §1 time grain of the source star, when declared. */
  grain?: string;
  /** The period this value belongs to, when the row is keyed by a time field. */
  period?: string;
}

/**
 * MeasureFormatter (ADR-0064 §2) — the deterministic, pure guard against BUG-1
 * (the 10× transcription bug). Turns a raw measure float into the business-ready
 * `display` string the prompt is permitted to quote verbatim, so the LLM never
 * holds the bare float it was mis-copying.
 *
 * Pure deep module: `(raw, hints) → display`, no DB, no IO, every branch
 * unit-testable. Mirrors the shape of `AdditivityGuard` / `SemanticsRenderer`.
 *
 * Magnitude rules (driven by `unit`, never by sniffing the number):
 *  - a `万`-prefixed unit (万元/万台) rolls up to its `亿` form past 1亿 (=10000万),
 *    carrying the original 万 value in parens so both magnitudes are legible:
 *    39012.84 万元 → "3.90 亿元（39,012.84 万元）"; 9999.99 万元 stays "9,999.99 万元".
 *  - '%' (a share) → "6.42%".
 *  - '元' (a price/ratio) → "3,901.28 元".
 *  - '' (a count) → grouped integer, no unit.
 */
export function formatMeasure(raw: number, hints: MeasureFormatHints = {}): string {
  const unit = hints.unit ?? '';

  if (!Number.isFinite(raw)) return String(raw);

  // Percentage (share): stored as a decimal (0.2742 → "27.42%"), so multiply by 100.
  if (unit === '%') return `${groupDigits(raw * 100, 2)}%`;

  // A 万-prefixed unit (万元/万台): roll to the 亿 form once |value| ≥ 1亿 (10000万),
  // keeping the original 万 figure in parens. This is the headline BUG-1 fix.
  if (unit.startsWith('万')) {
    const yiUnit = `亿${unit.slice(1)}`;
    if (Math.abs(raw) >= 10000) {
      return `${groupDigits(raw / 10000, 2)} ${yiUnit}（${groupDigits(raw, 2)} ${unit}）`;
    }
    return `${groupDigits(raw, 2)} ${unit}`;
  }

  // A bare-unit measure (元 price, 万台 already handled): two decimals + unit.
  if (unit) return `${groupDigits(raw, 2)} ${unit}`;

  // Unitless: a whole count stays an integer; a fractional unitless value keeps 2 decimals.
  return Number.isInteger(raw) ? groupDigits(raw, 0) : groupDigits(raw, 2);
}

/**
 * Wrap a raw measure value in its self-describing envelope. The single place a
 * `MeasureCell` is constructed, so `display` and `raw` can never drift apart.
 */
export function toMeasureCell(raw: number, hints: MeasureFormatHints = {}): MeasureCell {
  const cell: MeasureCell = {
    display: formatMeasure(raw, hints),
    raw,
    unit: hints.unit ?? '',
    metric: hints.metric ?? '',
    additivity: hints.additivity ?? 'additive',
  };
  if (hints.universe !== undefined) cell.universe = hints.universe;
  if (hints.grain !== undefined) cell.grain = hints.grain;
  if (hints.period !== undefined) cell.period = hints.period;
  return cell;
}

/** Fixed-decimal formatting with thousands separators, sign-safe. */
function groupDigits(value: number, decimals: number): string {
  const fixed = value.toFixed(decimals);
  const negative = fixed.startsWith('-');
  const unsigned = negative ? fixed.slice(1) : fixed;
  const [intPart, decPart] = unsigned.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = decPart !== undefined ? `${grouped}.${decPart}` : grouped;
  return negative ? `-${body}` : body;
}
