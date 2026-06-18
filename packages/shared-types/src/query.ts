import { PaginatedRequest } from './common';
import type { MeasureCell } from './ontology';

export type FilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in';

export interface QueryFilter {
  field?: string;
  derivedProperty?: string;
  operator: FilterOperator;
  value: unknown;
  params?: Record<string, unknown>;
}

export interface QuerySort {
  field: string;
  direction: 'asc' | 'desc';
}

export interface QueryObjectsRequest extends PaginatedRequest {
  objectType: string;
  filters?: QueryFilter[];
  search?: string;
  sort?: QuerySort;
  include?: string[];
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
    sortFallbackReason?: string;
    /** Structured advisories from the read path (e.g. Coverage Gate's
     *  ESSENCE_COVERAGE_MODEL_UNAVAILABLE) — never an error, surfaced so the
     *  Agent can answer honestly about data coverage. See ADR-0044. */
    warnings?: string[];
  };
}

export interface ObjectInstanceResult {
  id: string;
  objectType: string;
  externalId: string;
  label: string | null;
  properties: Record<string, unknown>;
  /**
   * ADR-0064 §2: self-describing envelopes for the row's numeric MEASURE fields,
   * keyed by property name. Rides BESIDE `properties` (which stays numeric and
   * untouched, so HTTP/web consumers are unaffected); the Agent quotes
   * `measures[field].display` verbatim instead of re-typesetting the raw float —
   * the structural guard against BUG-1. Absent when the row carries no measure.
   */
  measures?: Record<string, MeasureCell>;
  relationships: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
