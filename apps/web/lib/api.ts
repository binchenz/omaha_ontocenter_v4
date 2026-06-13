const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

import type { CurrentUser, LoginResponse } from '@omaha/shared-types';

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
  // 204 No Content (e.g. DELETE) or empty body — nothing to parse.
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }
  return res.json();
}

export const api = {
  login: (tenantSlug: string, email: string, password: string) =>
    request<{ accessToken: string; user: LoginResponse['user'] }>('/auth/login', {
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

  // --- Draft lifecycle (OPC workbench, ADR-0030/0031) ---
  getDraft: () => request<{ draft: DraftRecord | null }>('/ontology/draft'),

  createDraft: () => request<DraftRecord>('/ontology/draft', { method: 'POST' }),

  replaceDraft: (snapshot: OntologySnapshot) =>
    request<DraftRecord>('/ontology/draft', { method: 'PUT', body: JSON.stringify({ snapshot }) }),

  discardDraft: () => request<void>('/ontology/draft', { method: 'DELETE' }),

  publishDraft: (confirmed = false) =>
    request<PublishResult>('/ontology/draft/publish', { method: 'POST', body: JSON.stringify({ confirmed }) }),

  preflightDraft: () => request<PublishPreflight>('/ontology/draft/preflight'),

  // --- Evals (ADR-0033) ---
  listEvals: () => request<EvalQuestionView[]>('/evals/questions'),

  deleteEval: (id: string) => request<void>(`/evals/questions/${id}`, { method: 'DELETE' }),

  runEval: (id: string) => request<EvalRunResult>(`/evals/questions/${id}/run`, { method: 'POST' }),

  runEvalN: (id: string, n = 8) =>
    request<EvalNRunResult>(`/evals/questions/${id}/run-n`, { method: 'POST', body: JSON.stringify({ n }) }),

  evalSoftGate: (threshold?: number) =>
    request<EvalSoftGate>(`/evals/soft-gate${threshold !== undefined ? `?threshold=${threshold}` : ''}`),

  // --- Reverse-inference (ADR-0032) ---
  listConnectors: () => request<Array<{ id: string; name: string; type: string }>>('/connectors'),

  reverseInfer: (connectorId: string, merge = false) =>
    request<{ snapshot: OntologySnapshot; stats: { tables: number; relationships: number; merged: boolean } }>(
      '/reverse-inference',
      { method: 'POST', body: JSON.stringify({ connectorId, merge }) },
    ),

  // --- Template library (ADR-0034) ---
  listTemplates: () => request<TemplateSummary[]>('/ontology/templates'),

  saveTemplate: (name: string, description?: string) =>
    request<TemplateSummary>('/ontology/templates', { method: 'POST', body: JSON.stringify({ name, description }) }),

  deleteTemplate: (id: string) => request<void>(`/ontology/templates/${id}`, { method: 'DELETE' }),

  applyTemplate: (id: string) =>
    request<{ types: number; questionsAdded: number }>(`/ontology/templates/${id}/apply`, { method: 'POST' }),

  // --- Setup (ADR-0049) ---
  setupStatus: () => request<{ initialized: boolean; slug?: string }>('/setup/status'),

  setupTestLlm: (apiKey: string) =>
    request<{ ok: boolean; error?: string }>('/setup/test-llm', { method: 'POST', body: JSON.stringify({ apiKey }) }),

  setupInitialize: (body: { tenantName: string; adminEmail: string; adminPassword: string; apiKey: string }) =>
    request<void>('/setup/initialize', { method: 'POST', body: JSON.stringify(body) }),

  // --- User management (ADR-0049) ---
  listUsers: () => request<UserRecord[]>('/users'),

  createUser: (body: { name: string; email: string; password: string; roleId: string }) =>
    request<UserRecord>('/users', { method: 'POST', body: JSON.stringify(body) }),

  deleteUser: (id: string) => request<void>(`/users/${id}`, { method: 'DELETE' }),

  listRoles: () => request<RoleRecord[]>('/permissions/roles'),

  confirmAction: (actionId: string) =>
    request<{ status: string }>(`/actions/${actionId}/confirm`, { method: 'POST' }),

  cancelAction: (actionId: string) =>
    request<{ status: string }>(`/actions/${actionId}/cancel`, { method: 'POST' }),
};

// Types
// The authenticated user is the same `CurrentUser` the back end issues — it carries
// `permissions`/`permissionRules`, the input to surface assembly (ADR-0041). Aliased
// as `User` to keep existing imports stable.
export type User = CurrentUser;

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
  description?: string;
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

// --- Ontology snapshot / draft (OPC workbench) ---
export type Provenance = 'metadata' | 'heuristic' | 'candidate';

export interface SnapshotProperty {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  filterable?: boolean;
  sortable?: boolean;
  description?: string;
  unit?: string;
  allowedValues?: string[];
  provenance?: Provenance;
  allowedValuesUnconfirmed?: boolean;
}

export interface SnapshotDerivedProperty extends SnapshotProperty {
  expression?: string;
}

export interface SnapshotObjectType {
  name: string;
  label: string;
  description?: string;
  properties: SnapshotProperty[];
  derivedProperties: SnapshotDerivedProperty[];
  externalIdCandidates?: string[];
  externalId?: string;
  provenance?: Provenance;
}

export interface SnapshotRelationship {
  name: string;
  sourceType: string;
  targetType: string;
  cardinality: string;
  description?: string;
  provenance?: Provenance;
}

export interface OntologySnapshot {
  version: number;
  objectTypes: SnapshotObjectType[];
  relationships: SnapshotRelationship[];
}

export interface DraftRecord {
  tenantId: string;
  snapshot: OntologySnapshot;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublishResult {
  createdTypes: string[];
  updatedTypes: string[];
  deletedTypes: string[];
  createdRelationships: string[];
  deletedRelationships: string[];
}

export type SnapshotChangeTier = 'safe' | 'breaking';
export interface SnapshotChange {
  kind: string;
  tier: SnapshotChangeTier;
  objectType: string;
  field?: string;
  detail: string;
  impactCount?: number;
}
export interface PublishPreflight {
  changes: SnapshotChange[];
  hasBreaking: boolean;
  canAutoPublish: boolean;
}

export interface EvalQuestionView {
  id: string;
  question: string;
  baselineTool: string;
  baselineArgs: Record<string, unknown>;
  planSummary: string | null;
  passHistory: number[];
  createdAt: string;
}

export interface EvalRunResult {
  questionId: string;
  question: string;
  pass: boolean;
  diffs: string[];
  actual: { tool: string; args: Record<string, unknown> } | null;
}

export interface EvalNRunResult {
  questionId: string;
  question: string;
  n: number;
  passes: number;
  passRate: number;
  runs: Array<{ pass: boolean; diffs: string[] }>;
}

export interface EvalSoftGate {
  threshold: number;
  total: number;
  belowThreshold: Array<{ id: string; question: string; passRate: number | null }>;
  requiresAck: boolean;
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  typeCount: number;
  questionCount: number;
  createdAt: string;
}

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  roleId: string;
  roleName: string;
}

export interface RoleRecord {
  id: string;
  name: string;
  permissions: string[];
}
