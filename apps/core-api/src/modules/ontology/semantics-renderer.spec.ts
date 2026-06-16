import { renderSemanticsHints } from './semantics-renderer';

/**
 * ADR-0061 §3: SemanticsRenderer turns an ObjectType's structural semantics
 * (collapsedDefault now; universe in #191) into Agent-readable hint lines, so the
 * schema "speaks" the rules that used to live in skill prose. Pure function:
 * semantics in → hint strings out, no IO.
 */
describe('SemanticsRenderer — renderSemanticsHints (ADR-0061)', () => {
  describe('collapsedDefault', () => {
    it('renders a folded-dimension hint carrying the key semantic warnings', () => {
      const hints = renderSemanticsHints({ collapsedDefault: { priceBand: '整体' } });
      expect(hints).toHaveLength(1);
      const h = hints[0];
      expect(h).toContain('priceBand');
      expect(h).toContain('整体');
      // the three load-bearing instructions that replace the prose paragraph:
      expect(h).toMatch(/默认折叠|折叠/);     // dimension is collapsed by default
      expect(h).toMatch(/groupBy|钻取|显式/);  // must drill explicitly
      expect(h).toMatch(/勿|不可|不要|始终存在/); // do NOT reverse-assert absence
    });

    it('renders one hint per folded dimension', () => {
      const hints = renderSemanticsHints({ collapsedDefault: { priceBand: '整体', region: '全国' } });
      expect(hints).toHaveLength(2);
      expect(hints.some((h) => h.includes('priceBand'))).toBe(true);
      expect(hints.some((h) => h.includes('region'))).toBe(true);
    });
  });

  describe('universe (ADR-0061 §2, #191)', () => {
    it('renders a top-sample warning naming the whole-market authority', () => {
      const hints = renderSemanticsHints({ universe: 'top-sample' });
      expect(hints).toHaveLength(1);
      expect(hints[0]).toMatch(/TOP|样本|非全市场/);
      expect(hints[0]).toContain('brand_share');
    });

    it('renders a whole-market note', () => {
      const hints = renderSemanticsHints({ universe: 'whole-market' });
      expect(hints).toHaveLength(1);
      expect(hints[0]).toMatch(/全市场|官方|整体口径/);
    });

    it('ignores an unknown universe value', () => {
      expect(renderSemanticsHints({ universe: 'something-else' })).toEqual([]);
    });

    it('combines folded-dimension and universe hints', () => {
      const hints = renderSemanticsHints({ collapsedDefault: { priceBand: '整体' }, universe: 'whole-market' });
      expect(hints).toHaveLength(2);
    });
  });

  describe('no semantics → no noise', () => {
    it('returns an empty array when nothing is declared', () => {
      expect(renderSemanticsHints({})).toEqual([]);
    });

    it('returns an empty array for an empty collapsedDefault map', () => {
      expect(renderSemanticsHints({ collapsedDefault: {} })).toEqual([]);
    });
  });
});
