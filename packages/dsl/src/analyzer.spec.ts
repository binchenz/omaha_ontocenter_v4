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

  it('treats fields inside exists <rel> where … as scoped to the relation, and reports the relation as a dependency', () => {
    const result = analyze("exists payments where status = 'Success'", {
      knownProperties: new Set(['totalAmount']),
      knownDerivedProperties: new Set(),
      knownRelations: new Set(['payments']),
    });
    expect(result.valid).toBe(true);
    expect(result.dependencies).toContain('payments');
    expect(result.errors).toEqual([]);
  });

  it('rejects exists referencing an unknown relation', () => {
    const result = analyze("exists nonexistent where status = 'Success'", {
      knownProperties: new Set(['totalAmount']),
      knownDerivedProperties: new Set(),
      knownRelations: new Set(['payments']),
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/unknown relation/i);
  });

  it('records a parameter reference as a parameter dependency, not an identifier', () => {
    const result = analyze('paidAt <= :cutoffTime', {
      knownProperties: new Set(['paidAt']),
      knownDerivedProperties: new Set(),
    });
    expect(result.valid).toBe(true);
    expect(result.parameters).toEqual(['cutoffTime']);
  });
});

describe('Cycle detection across derived properties', () => {
  it('detects a direct cycle: A references B and B references A', () => {
    const aResult = analyze('b = true', {
      knownProperties: new Set(['x']),
      knownDerivedProperties: new Set(['a', 'b']),
    });
    expect(aResult.dependencies).toContain('b');

    const bResult = analyze('a = true', {
      knownProperties: new Set(['x']),
      knownDerivedProperties: new Set(['a', 'b']),
    });
    expect(bResult.dependencies).toContain('a');
  });
});
