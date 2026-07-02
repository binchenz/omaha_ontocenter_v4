import type { CompileContext } from './compiler';
import type { OntologyView } from './ontology-view';

/**
 * Build a CompileContext from an OntologyView and optional named parameters.
 *
 * This is the single source of truth for how DSL compilation contexts are
 * constructed from ontology metadata. Both ScopedWhere (for user filters and
 * derived properties) and QueryPlanner (for derived metrics) import and call
 * this to ensure they build contexts with identical structure.
 *
 * **Why this exists (ADR-0065 Slice 0)**:
 * Before this builder, ScopedWhere constructed its CompileContext inline
 * (line 147-153 of scoped-where.ts). When QueryPlanner needs to compile
 * derived-metric expressions, duplicating that construction would create
 * drift risk: one path could forget `relations`, causing runtime failures
 * like "Unknown relation: X" only when a derived metric uses cross-entity
 * operations (EXISTS, path traversal, relation aggregates).
 *
 * By extracting this pure function:
 * - One change updates both call sites
 * - Impossible for one to include `relations` while the other omits it
 * - Unit-testable in isolation with fixtures
 * - `git blame` shows all context-shape decisions in one history
 *
 * @param view The OntologyView containing field type sets and relations
 * @param params Optional named parameter bindings for derived property/metric expressions
 * @returns A CompileContext ready to pass to `compile(ast, ctx)`
 */
export function buildCompileContext(
  view: OntologyView,
  params?: Record<string, unknown>,
): CompileContext {
  return {
    numericFields: view.numericFields,
    booleanFields: view.booleanFields,
    stringFields: view.stringFields,
    relations: view.relations,
    // Pass params by reference — the DSL compiler doesn't mutate it, so the shallow copy
    // just wastes allocations when called per-metric in buildMetricExprs hot path
    params: params ?? {},
  };
}
