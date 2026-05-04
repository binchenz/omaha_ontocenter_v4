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
});
