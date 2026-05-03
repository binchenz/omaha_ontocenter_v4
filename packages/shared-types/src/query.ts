export type FilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in';

export interface QueryFilter {
  field: string;
  operator: FilterOperator;
  value: unknown;
}

export interface QuerySort {
  field: string;
  direction: 'asc' | 'desc';
}

export interface QueryObjectsRequest {
  objectType: string;
  filters?: QueryFilter[];
  search?: string;
  sort?: QuerySort;
  page?: number;
  pageSize?: number;
  select?: string[];
}

export interface QueryObjectsResponse {
  data: ObjectInstanceResult[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    objectType: string;
  };
}

export interface ObjectInstanceResult {
  id: string;
  objectType: string;
  externalId: string;
  label: string | null;
  properties: Record<string, unknown>;
  relationships: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
