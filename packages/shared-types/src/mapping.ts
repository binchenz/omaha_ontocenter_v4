export interface PropertyMapping {
  objectProperty: string;
  sourceColumn: string;
  transform?: string;
}

export interface CreateMappingRequest {
  objectTypeId: string;
  connectorId: string;
  tableName: string;
  propertyMappings: Record<string, PropertyMapping>;
  relationshipMappings?: Record<string, unknown>;
}

export interface MappingResponse {
  id: string;
  tenantId: string;
  objectTypeId: string;
  connectorId: string;
  tableName: string;
  propertyMappings: Record<string, PropertyMapping>;
  relationshipMappings: Record<string, unknown>;
  createdAt: string;
}
