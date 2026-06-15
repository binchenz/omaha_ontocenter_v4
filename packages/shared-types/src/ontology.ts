export interface PropertyDefinition {
  name: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'json';
  required?: boolean;
  filterable?: boolean;
  sortable?: boolean;
  precision?: number;
  scale?: number;
  description?: string;
  unit?: string;
  /**
   * Controlled value set for a low-cardinality string field (e.g. status,
   * grade, relation type). A hard constraint: instance values outside this set
   * are rejected at import time. Only meaningful for `type: 'string'`.
   * Normalization of dirty source values is an upstream ETL concern — the
   * ontology only gates, it does not clean.
   */
  allowedValues?: string[];
}

export interface DerivedPropertyDefinition extends PropertyDefinition {
  expression: string;
  params?: Array<{ name: string; type: 'datetime' | 'decimal' | 'string' | 'int' | 'boolean' }>;
}

/**
 * ADR-0057: Dimension constraints for query-time validation.
 * Declared per ObjectType — required dims must be filtered, defaulted dims auto-inject.
 */
export interface DimensionConstraints {
  /** Properties that MUST appear in filters — omission returns structured error + available values */
  required: string[];
  /** Properties auto-injected with a default value when not filtered explicitly */
  defaults: Record<string, string>;
}

export interface CreateObjectTypeRequest {
  name: string;
  label: string;
  description?: string;
  properties: PropertyDefinition[];
  derivedProperties?: DerivedPropertyDefinition[];
  dimensions?: DimensionConstraints;
}

export interface UpdateObjectTypeRequest {
  label?: string;
  description?: string;
  properties?: PropertyDefinition[];
  derivedProperties?: DerivedPropertyDefinition[];
  dimensions?: DimensionConstraints;
}

export interface ObjectTypeResponse {
  id: string;
  tenantId: string;
  name: string;
  label: string;
  description?: string;
  properties: PropertyDefinition[];
  derivedProperties: DerivedPropertyDefinition[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type Cardinality = 'one-to-one' | 'one-to-many' | 'many-to-many';

export interface CreateRelationshipRequest {
  sourceTypeId: string;
  targetTypeId: string;
  name: string;
  cardinality: Cardinality;
  description?: string;
}

export interface RelationshipResponse {
  id: string;
  tenantId: string;
  sourceTypeId: string;
  targetTypeId: string;
  name: string;
  cardinality: Cardinality;
  description?: string;
  createdAt: string;
}
