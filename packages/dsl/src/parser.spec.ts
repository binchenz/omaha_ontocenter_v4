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
});
