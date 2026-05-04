export interface PropertyDefinition {
  name: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'json';
  required?: boolean;
  filterable?: boolean;
  sortable?: boolean;
  precision?: number;
  scale?: number;
}

export interface CreateObjectTypeRequest {
  name: string;
  label: string;
  properties: PropertyDefinition[];
  derivedProperties?: PropertyDefinition[];
}

export interface UpdateObjectTypeRequest {
  label?: string;
  properties?: PropertyDefinition[];
  derivedProperties?: PropertyDefinition[];
}

export interface ObjectTypeResponse {
  id: string;
  tenantId: string;
  name: string;
  label: string;
  properties: PropertyDefinition[];
  derivedProperties: PropertyDefinition[];
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
}

export interface RelationshipResponse {
  id: string;
  tenantId: string;
  sourceTypeId: string;
  targetTypeId: string;
  name: string;
  cardinality: Cardinality;
  createdAt: string;
}
