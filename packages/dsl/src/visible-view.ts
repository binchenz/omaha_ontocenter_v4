import { analyze } from './analyzer';
import type { OntologyView } from './ontology-view';

/**
 * Field visibility for an OntologyView. `allowedFields` is the principal's
 * visible BASE property set, exactly as produced by the permission resolver
 * (`collectAllowedFields`): `null` means "all fields visible" (admin / a role
 * with no field restriction) and is the overwhelmingly common case.
 *
 * These two functions are the INPUT-seam half of field-level permission
 * enforcement. They never touch the OUTPUT seam (`toInstanceDto`) and never
 * touch compiled permission Predicates — a Predicate carries its own full
 * OntologyView ({ ast, view, params }) and is emitted against that, so a
 * permission condition may legitimately reference a field the end user cannot
 * see (e.g. `salaryBand = :tier`). Narrowing here only affects which fields a
 * USER-SUPPLIED filter / sort / groupBy / metric may name.
 */

/**
 * The set of property names visible to a principal, base ∪ fully-visible
 * derived. A Derived Property is visible iff every base field in its transitive
 * dependency closure is visible (filtering an unmasked derived property whose
 * base is masked would otherwise leak the masked value). Returns `null`
 * (= all visible) untouched.
 *
 * `analyze().dependencies` yields base property names AND relation names (from
 * count/aggregate/exists nodes); relation names are pass-through — relationships
 * are not field-masked in this seam — so a dependency that is not itself a known
 * property and not a known derived property (i.e. a relation) does not gate
 * visibility. Memoized and cycle-guarded; the derived DAG is acyclic by the
 * save-time guarantee, but the guard keeps this total regardless.
 */
export function visibleClosure(
  view: OntologyView,
  allowedFields: Set<string> | null,
): Set<string> | null {
  if (allowedFields === null) return null;

  const baseFields = new Set<string>([
    ...view.numericFields,
    ...view.booleanFields,
    ...view.stringFields,
  ]);
  const analyzerCtx = {
    knownProperties: baseFields,
    knownDerivedProperties: new Set(view.derivedProperties.keys()),
    knownRelations: new Set(Object.keys(view.relations)),
  };

  const memo = new Map<string, boolean>();
  const isVisible = (name: string, stack: Set<string>): boolean => {
    const cached = memo.get(name);
    if (cached !== undefined) return cached;
    if (stack.has(name)) return false; // cycle guard — fail closed

    const derived = view.derivedProperties.get(name);
    if (!derived) {
      // Base field: visible iff allowed. A name that is neither a known base
      // field nor a derived property (a relation, or unknown) is not a maskable
      // field — treat as visible so it never spuriously hides a derived prop.
      const result = baseFields.has(name) ? allowedFields.has(name) : true;
      memo.set(name, result);
      return result;
    }

    stack.add(name);
    const deps = analyze(derived.expression, analyzerCtx).dependencies;
    const result = deps.every((dep) => isVisible(dep, stack));
    stack.delete(name);
    memo.set(name, result);
    return result;
  };

  const visible = new Set<string>(allowedFields);
  for (const name of view.derivedProperties.keys()) {
    if (isVisible(name, new Set())) visible.add(name);
  }
  return visible;
}

/**
 * A non-mutating projection of an OntologyView narrowed to a principal's
 * visible fields. The INPUT-seam gates (filter → filterableFields, groupBy →
 * filterableFields, sort → sortableFields, numeric metric → numericFields) all
 * trust these capability sets, so a masked field falls out of every gate and is
 * rejected with the SAME error as a genuinely non-capable / absent field — no
 * existence oracle. Derived properties whose base closure is not fully visible
 * are pruned from `derivedProperties`, so a derived filter on them hits the
 * existing "Unknown derived property" path.
 *
 * `null` allowedFields (the common case) returns the input view by reference —
 * no allocation, no copy. NEVER mutates the input (the loader's per-request,
 * principal-free cached view must stay intact for predicate compilation).
 *
 * `relations` is left intact: include foreign keys are resolved relation
 * metadata, not user-supplied field names, so they are gated elsewhere.
 */
export function projectVisible(
  view: OntologyView,
  allowedFields: Set<string> | null,
): OntologyView {
  const visible = visibleClosure(view, allowedFields);
  if (visible === null) return view;

  const keep = (s: Set<string>): Set<string> =>
    new Set([...s].filter((f) => visible.has(f)));

  return {
    ...view,
    numericFields: keep(view.numericFields),
    booleanFields: keep(view.booleanFields),
    stringFields: keep(view.stringFields),
    filterableFields: keep(view.filterableFields),
    sortableFields: keep(view.sortableFields),
    derivedProperties: new Map(
      [...view.derivedProperties].filter(([name]) => visible.has(name)),
    ),
    // The mask itself curates this view: gates must treat the capability sets as
    // an exact whitelist, not fall back to "uncurated ⇒ allow all" when the
    // narrowed set is empty.
    visibilityRestricted: true,
  };
}
