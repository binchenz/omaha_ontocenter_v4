import { estimateTokens, PROMPT_BUDGET_WARN, PROMPT_BUDGET_ERROR } from '../prompt-budget';

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('scales with input length', () => {
    const a = estimateTokens('hello');
    const b = estimateTokens('hello hello hello hello');
    expect(b).toBeGreaterThan(a);
  });

  it('returns a non-negative integer', () => {
    const result = estimateTokens('some test text');
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('uses chars / 1.5 heuristic', () => {
    expect(estimateTokens('abc')).toBe(Math.ceil(3 / 1.5));
    expect(estimateTokens('a'.repeat(150))).toBe(100);
  });
});

describe('threshold constants', () => {
  it('WARN is 4000 and ERROR is 5000', () => {
    expect(PROMPT_BUDGET_WARN).toBe(4000);
    expect(PROMPT_BUDGET_ERROR).toBe(5000);
  });
});
