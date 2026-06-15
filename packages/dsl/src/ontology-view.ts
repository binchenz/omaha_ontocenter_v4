export interface OntologyDerivedPropertyView {
  name: string;
  expression: string;
  params?: Array<{ name: string; type: 'datetime' | 'decimal' | 'string' | 'int' | 'boolean' }>;
}

/**
 * One relationship out of (or into) the current Object Type, resolved for
 * traversal (ADR-0044). The canonical instance-link convention is
 * `relationships: { <storageKey>: <other side's external_id> }`, where
 * `storageKey` is the relation NAME (unique per `(tenant, sourceType, name)`).
 *
 * - `fkSide: 'self'`  — the current type's rows physically hold the FK:
 *     `object_instances.relationships->>'<storageKey>' = other.external_id`
 * - `fkSide: 'other'` — the related type's rows hold the FK pointing back:
 *     `other.relationships->>'<storageKey>' = object_instances.external_id`
 */
export interface RelationInfo {
  storageKey: string;
  otherType: string;
  fkSide: 'self' | 'other';
}

export interface OntologyView {
  tenantId: string;
  objectType: string;

  numericFields: Set<string>;
  booleanFields: Set<string>;
  stringFields: Set<string>;

  filterableFields: Set<string>;
  sortableFields: Set<string>;

  relations: Record<string, RelationInfo>;
  derivedProperties: Map<string, OntologyDerivedPropertyView>;

  /**
   * ADR-0057: Dimension constraints.
   * - `required`: filters MUST constrain these fields or the query returns a structured error.
   * - `defaults`: these fields are auto-injected when not explicitly filtered.
   */
  dimensions?: {
    required: string[];
    defaults: Record<string, string>;
  };

  /**
   * Set by `projectVisible` when the view has been narrowed to a restricted
   * principal's visible fields. Tells the input gates to treat the (possibly
   * now-empty) capability sets as an EXACT whitelist — i.e. suppress the
   * "uncurated type ⇒ allow all" leniency, which would otherwise re-open field
   * visibility when a principal sees none of a type's filterable/numeric fields.
   * Undefined on an unprojected (type-system) view.
   */
  visibilityRestricted?: boolean;
}
