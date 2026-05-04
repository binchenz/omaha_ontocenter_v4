import { parse, Ast } from './parser';

export interface AnalyzerContext {
  knownProperties: Set<string>;
  knownDerivedProperties: Set<string>;
  knownRelations?: Set<string>;
}

export interface AnalyzeResult {
  valid: boolean;
  dependencies: string[];
  parameters: string[];
  errors: string[];
}

export function analyze(src: string, ctx: AnalyzerContext): AnalyzeResult {
  const deps: string[] = [];
  const params: string[] = [];
  const errors: string[] = [];

  let ast: Ast;
  try {
    ast = parse(src);
  } catch (e) {
    return { valid: false, dependencies: [], parameters: [], errors: [(e as Error).message] };
  }

  check(ast, { ...ctx, insideRelation: false }, deps, params, errors);
  return { valid: errors.length === 0, dependencies: deps, parameters: params, errors };
}

interface CheckCtx extends AnalyzerContext {
  insideRelation: boolean;
}

function check(ast: Ast, ctx: CheckCtx, deps: string[], params: string[], errors: string[]): void {
  switch (ast.kind) {
    case 'ident':
      if (ctx.insideRelation) return; // relation-scoped fields are not validated at this layer
      if (!ctx.knownProperties.has(ast.name) && !ctx.knownDerivedProperties.has(ast.name)) {
        errors.push(`Unknown identifier: ${ast.name}`);
      } else if (!deps.includes(ast.name)) {
        deps.push(ast.name);
      }
      return;
    case 'param':
      if (!params.includes(ast.name)) params.push(ast.name);
      return;
    case 'number':
    case 'string':
    case 'bool':
      return;
    case 'compare':
      check(ast.left, ctx, deps, params, errors);
      check(ast.right, ctx, deps, params, errors);
      return;
    case 'and':
    case 'or':
      check(ast.left, ctx, deps, params, errors);
      check(ast.right, ctx, deps, params, errors);
      return;
    case 'not':
      check(ast.expr, ctx, deps, params, errors);
      return;
    case 'binop':
      check(ast.left, ctx, deps, params, errors);
      check(ast.right, ctx, deps, params, errors);
      return;
    case 'count':
      if (ctx.knownRelations && !ctx.knownRelations.has(ast.relation)) {
        errors.push(`Unknown relation: ${ast.relation}`);
      }
      if (!deps.includes(ast.relation)) deps.push(ast.relation);
      return;
    case 'aggregate':
      if (ctx.knownRelations && !ctx.knownRelations.has(ast.relation)) {
        errors.push(`Unknown relation: ${ast.relation}`);
      }
      if (!deps.includes(ast.relation)) deps.push(ast.relation);
      return;
    case 'exists':
      if (ctx.knownRelations && !ctx.knownRelations.has(ast.relation)) {
        errors.push(`Unknown relation: ${ast.relation}`);
      }
      if (!deps.includes(ast.relation)) deps.push(ast.relation);
      check(ast.predicate, { ...ctx, insideRelation: true }, deps, params, errors);
      return;
  }
}
