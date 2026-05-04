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
}
