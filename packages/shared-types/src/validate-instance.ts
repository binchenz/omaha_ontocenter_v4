import type { PropertyDefinition } from './ontology';

export interface AllowedValueViolation {
  field: string;
  value: string;
  allowed: string[];
}

/**
 * Validate an object instance's properties against the controlled value sets
 * (`allowedValues`) declared on its property definitions. Pure and dependency-free
 * so both write paths can share it: the runtime ImportEngine (core-api) and the
 * script-side IngestRecipe importer (scripts/, outside Nest DI).
 *
 * Only string properties with a non-empty `allowedValues` are gated. Empty
 * values (null / undefined / '') are skipped — `allowedValues` constrains the
 * domain of present values, it does not imply `required`.
 *
 * Returns the list of violations (empty = passes). Callers decide the policy
 * (reject the whole batch, skip the row, etc.); this function does not throw.
 */
export function validateInstanceProperties(
  properties: Record<string, unknown>,
  propertyDefs: PropertyDefinition[],
): AllowedValueViolation[] {
  const violations: AllowedValueViolation[] = [];
  for (const def of propertyDefs) {
    if (def.type !== 'string') continue;
    if (!def.allowedValues || def.allowedValues.length === 0) continue;
    const raw = properties[def.name];
    if (raw === null || raw === undefined) continue;
    const value = String(raw).trim();
    if (value === '') continue;
    if (!def.allowedValues.includes(value)) {
      violations.push({ field: def.name, value, allowed: def.allowedValues });
    }
  }
  return violations;
}
