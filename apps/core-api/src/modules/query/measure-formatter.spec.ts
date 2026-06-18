import { formatMeasure, toMeasureCell } from './measure-formatter';

/**
 * ADR-0064 §2: MeasureFormatter is the deterministic guard against BUG-1 (the 10×
 * transcription bug). Pure function: (raw, hints) → display. The most important
 * suite in the semantic-layer work — order-of-magnitude correctness is enforced
 * here by code, never by the LLM. Mirrors semantics-renderer.spec.ts style.
 */
describe('MeasureFormatter — formatMeasure (ADR-0064)', () => {
  describe('万元 → 亿元 rollup (the BUG-1 fix)', () => {
    it('rolls a ≥1亿 万元 value up to 亿元 and keeps the 万元 figure in parens', () => {
      // The exact UAT figure: 39,012.84 万元 must never be reportable as 3,901.28.
      const d = formatMeasure(39012.84, { unit: '万元' });
      expect(d).toBe('3.90 亿元（39,012.84 万元）');
    });

    it('keeps a sub-亿 value in 万元 (no rollup below 10000万)', () => {
      expect(formatMeasure(9999.99, { unit: '万元' })).toBe('9,999.99 万元');
      expect(formatMeasure(3901.28, { unit: '万元' })).toBe('3,901.28 万元');
    });

    it('rolls exactly at the 1亿 threshold (10000万 = 1.00亿)', () => {
      expect(formatMeasure(10000, { unit: '万元' })).toBe('1.00 亿元（10,000.00 万元）');
    });

    it('groups thousands in a large 亿元 value', () => {
      // 547,100 万元 = 54.71 亿元 (the D1 annual roll-up figure from the UAT).
      expect(formatMeasure(547100, { unit: '万元' })).toBe('54.71 亿元（547,100.00 万元）');
    });

    it('handles 万台 (零售量) the same way, rolling to 亿台', () => {
      expect(formatMeasure(12345.67, { unit: '万台' })).toBe('1.23 亿台（12,345.67 万台）');
      expect(formatMeasure(820.5, { unit: '万台' })).toBe('820.50 万台');
    });
  });

  describe('share as percent', () => {
    it('formats a share value with a percent sign and two decimals', () => {
      expect(formatMeasure(6.42, { unit: '%' })).toBe('6.42%');
      expect(formatMeasure(0.018, { unit: '%' })).toBe('0.02%');
    });
  });

  describe('ratio / price (元)', () => {
    it('formats 零售均价 as a grouped 元 value with two decimals', () => {
      expect(formatMeasure(1475.5, { unit: '元' })).toBe('1,475.50 元');
    });
  });

  describe('unitless counts', () => {
    it('formats a whole count as a grouped integer with no unit', () => {
      expect(formatMeasure(53, {})).toBe('53');
      expect(formatMeasure(12345, {})).toBe('12,345');
    });

    it('keeps two decimals for a fractional unitless value', () => {
      expect(formatMeasure(3.5, {})).toBe('3.50');
    });
  });

  describe('edge cases', () => {
    it('formats negative magnitudes sign-safely', () => {
      expect(formatMeasure(-39012.84, { unit: '万元' })).toBe('-3.90 亿元（-39,012.84 万元）');
      expect(formatMeasure(-6.42, { unit: '%' })).toBe('-6.42%');
    });

    it('passes a non-finite value through rather than printing NaN math', () => {
      expect(formatMeasure(Number.NaN, { unit: '万元' })).toBe('NaN');
    });

    it('rounds at the decimal boundary', () => {
      expect(formatMeasure(9999.995, { unit: '元' })).toBe('10,000.00 元');
    });
  });
});

describe('MeasureFormatter — toMeasureCell envelope', () => {
  it('builds a well-formed cell: display present, raw preserved, semantics labelled', () => {
    const cell = toMeasureCell(39012.84, {
      unit: '万元',
      metric: '零售额',
      additivity: 'additive',
      universe: 'whole-market',
      grain: 'month',
      period: '26.04',
    });
    expect(cell).toEqual({
      display: '3.90 亿元（39,012.84 万元）',
      raw: 39012.84,
      unit: '万元',
      metric: '零售额',
      additivity: 'additive',
      universe: 'whole-market',
      grain: 'month',
      period: '26.04',
    });
  });

  it('preserves raw exactly so the LLM can still reason on it (display ≠ raw)', () => {
    const cell = toMeasureCell(39012.844851, { unit: '万元', metric: '零售额' });
    expect(cell.raw).toBe(39012.844851);
    expect(cell.display).toBe('3.90 亿元（39,012.84 万元）');
  });

  it('defaults additivity to additive and omits absent optional fields', () => {
    const cell = toMeasureCell(53, { metric: 'n' });
    expect(cell.additivity).toBe('additive');
    expect(cell.display).toBe('53');
    expect('universe' in cell).toBe(false);
    expect('grain' in cell).toBe(false);
    expect('period' in cell).toBe(false);
  });

  it('carries a non-additive caliber for a share metric', () => {
    const cell = toMeasureCell(6.42, { unit: '%', metric: '份额', additivity: 'non-additive' });
    expect(cell.additivity).toBe('non-additive');
    expect(cell.display).toBe('6.42%');
  });
});
