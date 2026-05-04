import { Ast, CompareOp } from './parser';

export interface CompileContext {
  numericFields: Set<string>;
  stringFields?: Set<string>;
  booleanFields?: Set<string>;
}

export interface CompiledFragment {
  sql: string;
  params: unknown[];
}

export function compile(ast: Ast, ctx: CompileContext): CompiledFragment {
  const params: unknown[] = [];
  const sql = emit(ast, ctx, params);
  return { sql, params };
}

function emit(ast: Ast, ctx: CompileContext, params: unknown[]): string {
  switch (ast.kind) {
    case 'compare':
      return emitCompare(ast.op, ast.left, ast.right, ctx, params);
    case 'and':
      return `(${emit(ast.left, ctx, params)} AND ${emit(ast.right, ctx, params)})`;
    case 'or':
      return `(${emit(ast.left, ctx, params)} OR ${emit(ast.right, ctx, params)})`;
    case 'not':
      return `(NOT ${emit(ast.expr, ctx, params)})`;
    default:
      throw new Error(`Unexpected top-level node: ${ast.kind}`);
  }
}

function emitCompare(op: CompareOp, left: Ast, right: Ast, ctx: CompileContext, params: unknown[]): string {
  const l = emitOperand(left, ctx, params);
  const r = emitOperand(right, ctx, params);
  return `(${l.sql} ${sqlOp(op)} ${r.sql})`;
}

function emitOperand(ast: Ast, ctx: CompileContext, params: unknown[]): { sql: string } {
  if (ast.kind === 'ident') {
    if (ctx.numericFields.has(ast.name)) {
      return { sql: `(properties->>'${ast.name}')::numeric` };
    }
    if (ctx.booleanFields?.has(ast.name)) {
      return { sql: `((properties->>'${ast.name}')::boolean)` };
    }
    return { sql: `(properties->>'${ast.name}')` };
  }
  if (ast.kind === 'number') {
    params.push(ast.value);
    return { sql: `$${params.length}` };
  }
  if (ast.kind === 'string') {
    params.push(ast.value);
    return { sql: `$${params.length}` };
  }
  if (ast.kind === 'bool') {
    params.push(ast.value);
    return { sql: `$${params.length}` };
  }
  throw new Error(`Unsupported operand kind: ${ast.kind}`);
}

function sqlOp(op: CompareOp): string {
  return op === '=' ? '=' : op === '!=' ? '<>' : op;
}
