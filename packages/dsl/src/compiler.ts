import { Ast, CompareOp, ArithOp, AggregateOp } from './parser';
import type { RelationInfo } from './ontology-view';

export type { RelationInfo };

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
      return `(${emitValue(ast.left, ctx, params, scope)} ${sqlOp(ast.op)} ${emitValue(ast.right, ctx, params, scope)})`;
    case 'and':
      return `(${emit(ast.left, ctx, params, scope)} AND ${emit(ast.right, ctx, params, scope)})`;
    case 'or':
      return `(${emit(ast.left, ctx, params, scope)} OR ${emit(ast.right, ctx, params, scope)})`;
    case 'not':
      return `(NOT ${emit(ast.expr, ctx, params, scope)})`;
    case 'exists': {
      const rel = ctx.relations?.[ast.relation];
      if (!rel) throw new Error(`Unknown relation: ${ast.relation}`);
      const predicate = emit(ast.predicate, ctx, params, 'child.properties');
      return (
        `EXISTS (SELECT 1 FROM object_instances child ` +
        `WHERE child.tenant_id = object_instances.tenant_id ` +
        `AND child.deleted_at IS NULL ` +
        `AND ${relJoin(rel, 'object_instances')} ` +
        `AND ${predicate})`
      );
    }
    // Value-producing nodes are allowed at the top level so derived property
    // expressions like `sum orders.totalAmount` (used as a SELECT fragment by
    // QueryPlanner.compileFilter) can compile standalone. See issue #61.
    case 'ident':
    case 'path':
    case 'param':
    case 'number':
    case 'string':
    case 'bool':
    case 'binop':
    case 'count':
    case 'aggregate':
      return emitValue(ast, ctx, params, scope);
    default:
      throw new Error(`Unexpected top-level node: ${(ast as { kind: string }).kind}`);
  }
}

function emitValue(ast: Ast, ctx: CompileContext, params: unknown[], scope: Scope): string {
  switch (ast.kind) {
    case 'ident':
      if (ctx.numericFields.has(ast.name)) return `(${scope}->>'${ast.name}')::numeric`;
      if (ctx.booleanFields?.has(ast.name)) return `((${scope}->>'${ast.name}')::boolean)`;
      return `(${scope}->>'${ast.name}')`;
    case 'path': {
      const rel = ctx.relations?.[ast.relation];
      if (!rel) throw new Error(`Unknown relation in path: ${ast.relation}`);
      // Scalar subquery resolving one field on the related type (ADR-0044).
      if (rel.fkSide === 'other') {
        return (
          `(SELECT (other.properties->>'${ast.field}') FROM object_instances other ` +
          `WHERE other.tenant_id = object_instances.tenant_id ` +
          `AND other.deleted_at IS NULL ` +
          `AND (other.relationships->>'${rel.storageKey}') = object_instances.external_id LIMIT 1)`
        );
      }
      return (
        `(SELECT (other.properties->>'${ast.field}') FROM object_instances other ` +
        `WHERE other.tenant_id = object_instances.tenant_id ` +
        `AND other.deleted_at IS NULL ` +
        `AND other.external_id = (object_instances.relationships->>'${rel.storageKey}') LIMIT 1)`
      );
    }    case 'param': {
      if (!ctx.params || !(ast.name in ctx.params)) throw new Error(`Missing parameter: ${ast.name}`);
      params.push(ctx.params[ast.name]);
      return `$${params.length}`;
    }
    case 'number':
      params.push(ast.value);
      return `$${params.length}`;
    case 'string':
      params.push(ast.value);
      return `$${params.length}`;
    case 'bool':
      params.push(ast.value);
      return `$${params.length}`;
    case 'binop':
      return `(${emitValue(ast.left, ctx, params, scope)} ${ast.op} ${emitValue(ast.right, ctx, params, scope)})`;
    case 'count': {
      const rel = ctx.relations?.[ast.relation];
      if (!rel) throw new Error(`Unknown relation: ${ast.relation}`);
      return (
        `(SELECT COUNT(*)::numeric FROM object_instances child ` +
        `WHERE child.tenant_id = object_instances.tenant_id ` +
        `AND child.deleted_at IS NULL ` +
        `AND ${relJoin(rel, 'object_instances')})`
      );
    }
    case 'aggregate': {
      const rel = ctx.relations?.[ast.relation];
      if (!rel) throw new Error(`Unknown relation: ${ast.relation}`);
      const op = ast.op.toUpperCase();
      return (
        `COALESCE((SELECT ${op}((child.properties->>'${ast.field}')::numeric) FROM object_instances child ` +
        `WHERE child.tenant_id = object_instances.tenant_id ` +
        `AND child.deleted_at IS NULL ` +
        `AND ${relJoin(rel, 'object_instances')}), 0)`
      );
    }
    default:
      throw new Error(`Unsupported value kind: ${ast.kind}`);
  }
}

function sqlOp(op: CompareOp): string {
  return op === '=' ? '=' : op === '!=' ? '<>' : op;
}

/**
 * Join condition for a correlated subquery aliased `child` that traverses one
 * relationship hop from `object_instances` (ADR-0044). The canonical link is
 * `relationships: { <storageKey>: <other side's external_id> }`.
 *
 * - fkSide='self'  : the parent row holds the FK → child is the *other* type,
 *     `object_instances.relationships->>'<key>' = child.external_id`
 * - fkSide='other' : the child row holds the FK pointing back at the parent,
 *     `child.relationships->>'<key>' = object_instances.external_id`
 */
function relJoin(rel: RelationInfo, table = 'object_instances'): string {
  if (rel.fkSide === 'self') {
    return `(${table}.relationships->>'${rel.storageKey}') = child.external_id`;
  }
  return `(child.relationships->>'${rel.storageKey}') = ${table}.external_id`;
}
