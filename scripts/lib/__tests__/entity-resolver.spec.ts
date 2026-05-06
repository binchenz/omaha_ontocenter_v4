import { describe, it, expect } from 'vitest';
import { resolveCharacterName, type CandidateCharacter } from '../entity-resolver';

const candidates = (items: Array<{ id: string; name: string }>): CandidateCharacter[] => items;

describe('resolveCharacterName', () => {
  it('returns the exact match when name string equals a candidate name', () => {
    const cs = candidates([
      { id: 'c1', name: '陆阳' },
      { id: 'c2', name: '云芝' },
    ]);
    expect(resolveCharacterName('陆阳', cs)).toBe('c1');
  });

  it('strips parenthetical suffix to match ("药老" → "药老（药尘）")', () => {
    const cs = candidates([{ id: 'c1', name: '药老（药尘）' }]);
    expect(resolveCharacterName('药老', cs)).toBe('c1');
  });

  it('strips parenthetical suffix in the input ("药老（药尘）" → "药老")', () => {
    const cs = candidates([{ id: 'c1', name: '药老' }]);
    expect(resolveCharacterName('药老（药尘）', cs)).toBe('c1');
  });

  it('extracts primary name before · separator ("霍格" → "霍格·米奈希尔")', () => {
    const cs = candidates([
      { id: 'c1', name: '霍格·米奈希尔' },
      { id: 'c2', name: '帝皇（尼欧斯）' },
    ]);
    expect(resolveCharacterName('霍格', cs)).toBe('c1');
  });

  it('returns null when no candidate matches by any strategy', () => {
    const cs = candidates([{ id: 'c1', name: '陆阳' }, { id: 'c2', name: '云芝' }]);
    expect(resolveCharacterName('恐虐', cs)).toBeNull();
  });

  it('returns null when multiple candidates match by the same strategy (ambiguous)', () => {
    const cs = candidates([
      { id: 'c1', name: '陆阳·A' },
      { id: 'c2', name: '陆阳·B' },
    ]);
    expect(resolveCharacterName('陆阳', cs)).toBeNull();
  });

  it('exact match wins over substring/primary-name when both would match', () => {
    const cs = candidates([
      { id: 'c_exact', name: '萧炎' },
      { id: 'c_prefix', name: '萧炎·大帝' },
    ]);
    expect(resolveCharacterName('萧炎', cs)).toBe('c_exact');
  });

  it('candidate with parenthetical exact match wins over bare substring', () => {
    const cs = candidates([
      { id: 'c_paren', name: '药老（药尘）' },
      { id: 'c_bare', name: '药' },
    ]);
    expect(resolveCharacterName('药老', cs)).toBe('c_paren');
  });

  it('returns null on empty candidate list', () => {
    expect(resolveCharacterName('陆阳', [])).toBeNull();
  });

  it('returns null on empty/whitespace-only input', () => {
    const cs = candidates([{ id: 'c1', name: '陆阳' }]);
    expect(resolveCharacterName('', cs)).toBeNull();
    expect(resolveCharacterName('   ', cs)).toBeNull();
  });
});
