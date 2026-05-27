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
}

export interface DerivedPropertyDefinition extends PropertyDefinition {
  expression: string;
  params?: Array<{ name: string; type: 'datetime' | 'decimal' | 'string' | 'int' | 'boolean' }>;
}

export interface CreateObjectTypeRequest {
  name: string;
  label: string;
  description?: string;
  properties: PropertyDefinition[];
  derivedProperties?: DerivedPropertyDefinition[];
}

export interface UpdateObjectTypeRequest {
  label?: string;
  description?: string;
  properties?: PropertyDefinition[];
  derivedProperties?: DerivedPropertyDefinition[];
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
