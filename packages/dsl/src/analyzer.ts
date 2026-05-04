import { parse, Ast } from './parser';

export interface AnalyzerContext {
  knownProperties: Set<string>;
  knownDerivedProperties: Set<string>;
}

export interface AnalyzeResult {
  valid: boolean;
  dependencies: string[];
  errors: string[];
}

export function analyze(src: string, ctx: AnalyzerContext): AnalyzeResult {
  const deps: string[] = [];
  const errors: string[] = [];

  let ast: Ast;
  try {
    ast = parse(src);
  } catch (e) {
    return { valid: false, dependencies: [], errors: [(e as Error).message] };
  }

  walk(ast, (node) => {
    if (node.kind === 'ident') {
      if (!ctx.knownProperties.has(node.name) && !ctx.knownDerivedProperties.has(node.name)) {
        errors.push(`Unknown identifier: ${node.name}`);
      } else if (!deps.includes(node.name)) {
        deps.push(node.name);
      }
    }
  });

  return { valid: errors.length === 0, dependencies: deps, errors };
}

function walk(ast: Ast, visit: (node: Ast) => void): void {
  visit(ast);
  switch (ast.kind) {
    case 'compare':
      walk(ast.left, visit);
      walk(ast.right, visit);
      return;
    case 'and':
    case 'or':
      walk(ast.left, visit);
      walk(ast.right, visit);
      return;
    case 'not':
      walk(ast.expr, visit);
      return;
  }
}
