import type { Ast } from './parser';
import type { OntologyView } from './ontology-view';
import { compile } from './compiler';

export interface Predicate {
  ast: Ast;
  view: OntologyView;
  params: Record<string, unknown>;
  scope: 'parent' | 'child';
}

export interface EmittedPredicate {
  sql: string;
  params: unknown[];
}

export function emit(predicate: Predicate): EmittedPredicate {
  return compile(predicate.ast, {
    numericFields: predicate.view.numericFields,
    booleanFields: predicate.view.booleanFields,
    stringFields: predicate.view.stringFields,
    relations: predicate.view.relations,
    params: predicate.params,
  });
}
