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
      relations: { payments: { storageKey: 'payments', otherType: 'payment', fkSide: 'other' } },
    });
    expect(out.sql).toContain('EXISTS');
    expect(out.sql).toContain("(child.relationships->>'payments') = object_instances.external_id");
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
      relations: { payments: { storageKey: 'payments', otherType: 'payment', fkSide: 'other' } },
    });
    expect(out.sql).toContain('COUNT(*)');
    expect(out.sql).toContain("(child.relationships->>'payments') = object_instances.external_id");
    expect(out.params).toEqual([1]);
  });

  it('compiles sum <rel>.<field> as a coalesced SUM subquery', () => {
    const ast = parse('sum payments.amount >= totalAmount');
    const out = compile(ast, {
      numericFields: new Set(['totalAmount', 'amount']),
      relations: { payments: { storageKey: 'payments', otherType: 'payment', fkSide: 'other' } },
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

  // Regression for #61: derived property expressions like `sum orders.totalAmount`
  // are value-producing (not predicates). QueryPlanner.compileFilter compiles the
  // raw derived expression standalone and then wraps it in a filter comparison,
  // so the compiler must emit value nodes at top level, not reject them.
  it('compiles a bare aggregate expression (top-level value node)', () => {
    const ast = parse('sum orders.totalAmount');
    const out = compile(ast, {
      numericFields: new Set(),
      relations: { orders: { storageKey: 'orders', otherType: 'order', fkSide: 'other' } },
    });
    expect(out.sql).toContain('COALESCE((SELECT SUM');
    expect(out.sql).toContain("(child.properties->>'totalAmount')::numeric");
  });

  it('compiles a bare ident expression (top-level value node)', () => {
    const ast = parse('totalAmount');
    const out = compile(ast, { numericFields: new Set(['totalAmount']) });
    expect(out.sql).toBe("(properties->>'totalAmount')::numeric");
  });

  it('compiles a bare count expression (top-level value node)', () => {
    const ast = parse('count orders');
    const out = compile(ast, {
      numericFields: new Set(),
      relations: { orders: { storageKey: 'orders', otherType: 'order', fkSide: 'other' } },
    });
    expect(out.sql).toContain('SELECT COUNT(*)');
  });

  describe('field path (ADR-0044)', () => {
    it('compiles path (fkSide=self) as scalar subquery looking up parent', () => {
      const ast = parse("customer.region = 'APAC'");
      const out = compile(ast, {
        numericFields: new Set(),
        relations: { customer: { storageKey: 'has_orders', otherType: 'customer', fkSide: 'self' } },
      });
      expect(out.sql).toContain("other.external_id = (object_instances.relationships->>'has_orders')");
      expect(out.sql).toContain("(other.properties->>'region')");
      expect(out.params).toEqual(['APAC']);
    });

    it('compiles path (fkSide=other) as scalar subquery looking up child', () => {
      const ast = parse('orders.totalAmount >= 1000');
      const out = compile(ast, {
        numericFields: new Set(),
        relations: { orders: { storageKey: 'orders', otherType: 'order', fkSide: 'other' } },
      });
      expect(out.sql).toContain("(other.relationships->>'orders') = object_instances.external_id");
      expect(out.sql).toContain("(other.properties->>'totalAmount')");
      expect(out.params).toEqual([1000]);
    });
  });
});
