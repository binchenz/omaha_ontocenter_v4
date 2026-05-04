import { Ast, CompareOp } from './parser';

export interface RelationInfo {
  /** Field name in the child's relationships JSONB that holds the parent id. */
  foreignKey: string;
}

export interface CompileContext {
  numericFields: Set<string>;
  stringFields?: Set<string>;
  booleanFields?: Set<string>;
  relations?: Record<string, RelationInfo>;
  params?: Record<string, unknown>;
}

export interface CompiledFragment {
  sql: string;
  params: unknown[];
}

export function compile(ast: Ast, ctx: CompileContext): CompiledFragment {
  const params: unknown[] = [];
  const sql = emit(ast, ctx, params, 'properties');
  return { sql, params };
}

type Scope = string;

function emit(ast: Ast, ctx: CompileContext, params: unknown[], scope: Scope): string {
  switch (ast.kind) {
    case 'compare':
      return emitCompare(ast.op, ast.left, ast.right, ctx, params, scope);
    case 'and':
      return `(${emit(ast.left, ctx, params, scope)} AND ${emit(ast.right, ctx, params, scope)})`;
    case 'or':
      return `(${emit(ast.left, ctx, params, scope)} OR ${emit(ast.right, ctx, params, scope)})`;
    case 'not':
      return `(NOT ${emit(ast.expr, ctx, params, scope)})`;
    case 'exists': {
      const relInfo = ctx.relations?.[ast.relation];
      if (!relInfo) {
        throw new Error(`Unknown relation: ${ast.relation}`);
      }
      const childScope = 'child.properties';
      const predicate = emit(ast.predicate, ctx, params, childScope);
      return (
        `EXISTS (` +
        `SELECT 1 FROM object_instances child ` +
        `WHERE child.tenant_id = object_instances.tenant_id ` +
        `AND child.deleted_at IS NULL ` +
        `AND (child.relationships->>'${relInfo.foreignKey}') = object_instances.id::text ` +
        `AND ${predicate}` +
        `)`
      );
    }
    default:
      throw new Error(`Unexpected top-level node: ${ast.kind}`);
  }
}

function emitCompare(
  op: CompareOp,
  left: Ast,
  right: Ast,
  ctx: CompileContext,
  params: unknown[],
  scope: Scope,
): string {
  const l = emitOperand(left, ctx, params, scope);
  const r = emitOperand(right, ctx, params, scope);
  return `(${l.sql} ${sqlOp(op)} ${r.sql})`;
}

function emitOperand(
  ast: Ast,
  ctx: CompileContext,
  params: unknown[],
  scope: Scope,
): { sql: string } {
  if (ast.kind === 'ident') {
    if (ctx.numericFields.has(ast.name)) {
      return { sql: `(${scope}->>'${ast.name}')::numeric` };
    }
    if (ctx.booleanFields?.has(ast.name)) {
      return { sql: `((${scope}->>'${ast.name}')::boolean)` };
    }
    return { sql: `(${scope}->>'${ast.name}')` };
  }
  if (ast.kind === 'param') {
    if (!ctx.params || !(ast.name in ctx.params)) {
      throw new Error(`Missing parameter: ${ast.name}`);
    }
    params.push(ctx.params[ast.name]);
    return { sql: `$${params.length}` };
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
