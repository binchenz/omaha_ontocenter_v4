import { analyze } from './analyzer';

describe('DSL analyzer', () => {
  it('returns the set of identifier dependencies in source order', () => {
    const result = analyze('totalAmount >= 1000', {
      knownProperties: new Set(['totalAmount']),
      knownDerivedProperties: new Set(),
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.dependencies).toEqual(['totalAmount']);
  });

  it('rejects an expression that references an unknown identifier', () => {
    const result = analyze('mystery >= 1', {
      knownProperties: new Set(['totalAmount']),
      knownDerivedProperties: new Set(),
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/unknown identifier/i);
    expect(result.errors[0]).toContain('mystery');
  });

  it('accepts identifiers that match known derived properties', () => {
    const result = analyze('isHighValue = true', {
      knownProperties: new Set(['totalAmount']),
      knownDerivedProperties: new Set(['isHighValue']),
    });
    expect(result.valid).toBe(true);
    expect(result.dependencies).toEqual(['isHighValue']);
  });

  it('reports a syntax error for malformed input', () => {
    const result = analyze('totalAmount >=', {
      knownProperties: new Set(['totalAmount']),
      knownDerivedProperties: new Set(),
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/end of expression|unexpected/i);
  });
});
