const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token');
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message ?? 'Request failed');
  }
  return res.json();
}

export const api = {
  login: (tenantSlug: string, email: string, password: string) =>
    request<{ accessToken: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ tenantSlug, email, password }),
    }),

  me: () => request<User>('/auth/me'),

  listObjectTypes: () => request<ObjectType[]>('/ontology/types'),

  getObjectType: (id: string) => request<ObjectType>(`/ontology/types/${id}`),

  listRelationships: () => request<Relationship[]>('/ontology/relationships'),

  queryObjects: (body: QueryObjectsRequest) =>
    request<QueryObjectsResponse>('/query/objects', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

// Types
export interface User {
  id: string;
  email: string;
  name: string;
  tenantId: string;
  role: string;
}

export interface PropertyDefinition {
  name: string;
  type: string;
  label: string;
  required?: boolean;
  filterable?: boolean;
  sortable?: boolean;
}

export interface DerivedPropertyDefinition {
  name: string;
  type: string;
  label: string;
  expression?: string;
}

export interface ObjectType {
  id: string;
  name: string;
  label: string;
  properties: PropertyDefinition[];
  derivedProperties: DerivedPropertyDefinition[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Relationship {
  id: string;
  name: string;
  cardinality: string;
  sourceType: ObjectType;
  targetType: ObjectType;
}

export interface QueryFilter {
  field?: string;
  derivedProperty?: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in';
  value: unknown;
  params?: Record<string, unknown>;
}

export interface QueryObjectsRequest {
  objectType: string;
  filters?: QueryFilter[];
  search?: string;
  sort?: { field: string; direction: 'asc' | 'desc' };
  page?: number;
  pageSize?: number;
  include?: string[];
  select?: string[];
}

export interface ObjectInstance {
  id: string;
  objectType: string;
  externalId: string;
  label: string;
  properties: Record<string, unknown>;
  relationships: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface QueryMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  objectType: string;
}

export interface QueryObjectsResponse {
  data: ObjectInstance[];
  meta: QueryMeta;
}
