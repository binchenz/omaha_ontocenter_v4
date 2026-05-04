import { parse } from './parser';
import { compile } from './compiler';

describe('DSL compiler', () => {
  it('compiles a numeric comparison to a JSONB expression', () => {
    const ast = parse('totalAmount >= 1000');
    const out = compile(ast, { numericFields: new Set(['totalAmount']) });
    expect(out).toEqual({
      sql: "((properties->>'totalAmount')::numeric >= $1)",
      params: [1000],
    });
  });

  it('compiles parameter reference :cutoffTime against a bound value', () => {
    const ast = parse('paidAt <= :cutoffTime');
    const out = compile(ast, {
      numericFields: new Set(),
      params: { cutoffTime: '2026-05-04T11:00:00Z' },
    });
    expect(out).toEqual({
      sql: "((properties->>'paidAt') <= $1)",
      params: ['2026-05-04T11:00:00Z'],
    });
  });

  it('compiles exists <rel> where ... into a correlated subquery', () => {
    const ast = parse("exists payments where status = 'Success'");
    const out = compile(ast, {
      numericFields: new Set(),
      relations: { payments: { foreignKey: 'orderId' } },
    });
    expect(out.sql).toContain('EXISTS');
    expect(out.sql).toContain("relationships->>'orderId'");
    expect(out.sql).toContain("properties->>'status'");
    expect(out.params).toEqual(['Success']);
  });

  it('throws when a parameter is referenced but not provided', () => {
    const ast = parse('paidAt <= :cutoffTime');
    expect(() => compile(ast, { numericFields: new Set(), params: {} })).toThrow(
      /missing parameter.*cutoffTime/i,
    );
  });

  it('compiles count <rel> as a correlated COUNT(*) subquery', () => {
    const ast = parse('count payments >= 1');
    const out = compile(ast, {
      numericFields: new Set(),
      relations: { payments: { foreignKey: 'orderId' } },
    });
    expect(out.sql).toContain('COUNT(*)');
    expect(out.sql).toContain("relationships->>'orderId'");
    expect(out.params).toEqual([1]);
  });

  it('compiles sum <rel>.<field> as a coalesced SUM subquery', () => {
    const ast = parse('sum payments.amount >= totalAmount');
    const out = compile(ast, {
      numericFields: new Set(['totalAmount', 'amount']),
      relations: { payments: { foreignKey: 'orderId' } },
    });
    expect(out.sql).toContain('COALESCE((SELECT SUM');
    expect(out.sql).toContain("(child.properties->>'amount')::numeric");
    expect(out.sql).toContain("(properties->>'totalAmount')::numeric");
  });

  it('compiles arithmetic + comparison correctly', () => {
    const ast = parse('totalAmount + 10 > 100');
    const out = compile(ast, { numericFields: new Set(['totalAmount']) });
    expect(out.sql).toBe("(((properties->>'totalAmount')::numeric + $1) > $2)");
    expect(out.params).toEqual([10, 100]);
  });
});
