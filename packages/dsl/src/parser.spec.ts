import { parse } from './parser';

describe('DSL parser', () => {
  it('parses a single comparison: totalAmount >= 1000', () => {
    const ast = parse('totalAmount >= 1000');
    expect(ast).toEqual({
      kind: 'compare',
      op: '>=',
      left: { kind: 'ident', name: 'totalAmount' },
      right: { kind: 'number', value: 1000 },
    });
  });

  it('parses boolean and/or with correct precedence: and binds tighter than or', () => {
    const ast = parse("region = 'A' or region = 'B' and priority > 5");
    expect(ast).toEqual({
      kind: 'or',
      left: {
        kind: 'compare',
        op: '=',
        left: { kind: 'ident', name: 'region' },
        right: { kind: 'string', value: 'A' },
      },
      right: {
        kind: 'and',
        left: {
          kind: 'compare',
          op: '=',
          left: { kind: 'ident', name: 'region' },
          right: { kind: 'string', value: 'B' },
        },
        right: {
          kind: 'compare',
          op: '>',
          left: { kind: 'ident', name: 'priority' },
          right: { kind: 'number', value: 5 },
        },
      },
    });
  });

  it('parses not + parenthesized expressions', () => {
    const ast = parse('not (totalAmount >= 1000)');
    expect(ast).toEqual({
      kind: 'not',
      expr: {
        kind: 'compare',
        op: '>=',
        left: { kind: 'ident', name: 'totalAmount' },
        right: { kind: 'number', value: 1000 },
      },
    });
  });

  it('parses exists <rel> where <predicate>', () => {
    const ast = parse("exists payments where status = 'Success'");
    expect(ast).toEqual({
      kind: 'exists',
      relation: 'payments',
      predicate: {
        kind: 'compare',
        op: '=',
        left: { kind: 'ident', name: 'status' },
        right: { kind: 'string', value: 'Success' },
      },
    });
  });

  it('parses not exists <rel> where <predicate>', () => {
    const ast = parse('not exists payments where amount > 0');
    expect(ast).toEqual({
      kind: 'not',
      expr: {
        kind: 'exists',
        relation: 'payments',
        predicate: {
          kind: 'compare',
          op: '>',
          left: { kind: 'ident', name: 'amount' },
          right: { kind: 'number', value: 0 },
        },
      },
    });
  });

  it('parses a parameter reference like :cutoffTime', () => {
    const ast = parse('paidAt <= :cutoffTime');
    expect(ast).toEqual({
      kind: 'compare',
      op: '<=',
      left: { kind: 'ident', name: 'paidAt' },
      right: { kind: 'param', name: 'cutoffTime' },
    });
  });

  it('parses count <rel>', () => {
    const ast = parse('count payments >= 1');
    expect(ast).toEqual({
      kind: 'compare',
      op: '>=',
      left: { kind: 'count', relation: 'payments' },
      right: { kind: 'number', value: 1 },
    });
  });

  it('parses sum <rel>.<field>', () => {
    const ast = parse('sum payments.amount >= totalAmount');
    expect(ast).toEqual({
      kind: 'compare',
      op: '>=',
      left: { kind: 'aggregate', op: 'sum', relation: 'payments', field: 'amount' },
      right: { kind: 'ident', name: 'totalAmount' },
    });
  });

  it('parses arithmetic with correct precedence: a + b * c', () => {
    const ast = parse('totalAmount + bonus * 2 > 100');
    expect(ast).toEqual({
      kind: 'compare',
      op: '>',
      left: {
        kind: 'binop',
        op: '+',
        left: { kind: 'ident', name: 'totalAmount' },
        right: {
          kind: 'binop',
          op: '*',
          left: { kind: 'ident', name: 'bonus' },
          right: { kind: 'number', value: 2 },
        },
      },
      right: { kind: 'number', value: 100 },
    });
  });
});
