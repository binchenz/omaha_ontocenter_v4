import { normalizeCategory, parsePriceBand } from './category';

describe('normalizeCategory', () => {
  it('returns the canonical 品类 unchanged for a known category', () => {
    expect(normalizeCategory('电饭煲')).toBe('电饭煲');
    expect(normalizeCategory('空气炸锅')).toBe('空气炸锅');
    expect(normalizeCategory('净水器')).toBe('净水器');
  });

  it('maps a known alias to its canonical 品类', () => {
    // AVC files the 破壁机 sheet under "食品料理机"; both name the same category.
    expect(normalizeCategory('破壁机')).toBe('食品料理机');
    // 料理机 is the short form of the same canonical category.
    expect(normalizeCategory('料理机')).toBe('食品料理机');
    // AVC files the microwave sheet under the finer "台式单功能微波炉"; it is a 微波炉.
    expect(normalizeCategory('台式单功能微波炉')).toBe('微波炉');
  });

  it('tolerates surrounding whitespace and full-width spaces', () => {
    expect(normalizeCategory('  电饭煲 ')).toBe('电饭煲');
    expect(normalizeCategory('　空气炸锅　')).toBe('空气炸锅');
  });

  it('returns null for an unknown category (the unjoinable-island guard)', () => {
    expect(normalizeCategory('扫地机器人')).toBeNull();
    expect(normalizeCategory('')).toBeNull();
  });
});

describe('parsePriceBand', () => {
  it('parses a closed range into [min, max]', () => {
    // PDF segmentation
    expect(parsePriceBand('200-399')).toEqual({ min: 200, max: 399 });
    // AVC segmentation — parsed literally, not reconciled to the PDF bands
    expect(parsePriceBand('400-500')).toEqual({ min: 400, max: 500 });
  });

  it('parses an open-ended upper band (≥ / +) with a null max', () => {
    expect(parsePriceBand('≥2000')).toEqual({ min: 2000, max: null });
    expect(parsePriceBand('2000+')).toEqual({ min: 2000, max: null });
    expect(parsePriceBand('≥4000')).toEqual({ min: 4000, max: null });
  });

  it('parses an open-ended lower band (≤ / <) from a zero floor', () => {
    expect(parsePriceBand('≤199')).toEqual({ min: 0, max: 199 });
    expect(parsePriceBand('<100')).toEqual({ min: 0, max: 100 });
  });

  it('normalizes full-width digits and the full-width tilde', () => {
    expect(parsePriceBand('２００-３９９')).toEqual({ min: 200, max: 399 });
    expect(parsePriceBand('200～399')).toEqual({ min: 200, max: 399 });
  });

  it('returns null for the overall/total column and for non-band text', () => {
    expect(parsePriceBand('整体')).toBeNull();
    expect(parsePriceBand('品牌')).toBeNull();
    expect(parsePriceBand('')).toBeNull();
  });
});
