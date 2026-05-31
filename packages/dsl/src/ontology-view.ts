export interface OntologyDerivedPropertyView {
  name: string;
  expression: string;
  params?: Array<{ name: string; type: 'datetime' | 'decimal' | 'string' | 'int' | 'boolean' }>;
}

export interface OntologyView {
  tenantId: string;
  objectType: string;

  numericFields: Set<string>;
  booleanFields: Set<string>;
  stringFields: Set<string>;

  filterableFields: Set<string>;
  sortableFields: Set<string>;

  relations: Record<string, { foreignKey: string }>;
  derivedProperties: Map<string, OntologyDerivedPropertyView>;

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
