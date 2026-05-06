import { BadRequestException, Injectable } from '@nestjs/common';
import { compile, parse, emit, emitScope, parentScope } from '@omaha/dsl';
import type { Predicate, OntologyView } from '@omaha/dsl';
import type { QueryFilter, FilterOperator } from '@omaha/shared-types';
import { OntologyViewLoader } from '../ontology/ontology-view-loader.service';

export interface PlannedQuery {
  sql: string;
  params: unknown[];
  countSql: string;
  effectivePermissionFilter: string | null;
  sortFallbackReason?: string;
}

export interface PlanArgs {
  tenantId: string;
  objectType: string;
  filters?: QueryFilter[];
  search?: string;
  sort?: { field: string; direction: 'asc' | 'desc' };
  skip: number;
  take: number;
  permissionPredicates?: Predicate[];
}

export interface AggregateMetric {
  kind: 'count' | 'countDistinct' | 'sum' | 'avg' | 'min' | 'max';
  field?: string;
  alias: string;
}

export interface AggregateOrderBy {
  kind: 'metric' | 'groupKey';
  by: string;
  direction: 'asc' | 'desc';
}

export interface AggregatePlanArgs {
  tenantId: string;
  objectType: string;
  filters?: QueryFilter[];
  groupBy?: string[];
  metrics: AggregateMetric[];
  orderBy?: AggregateOrderBy[];
  maxGroups?: number;
  permissionPredicates?: Predicate[];
}

export interface PlannedAggregateQuery {
  sql: string;
  params: unknown[];
  effectivePermissionFilter: string | null;
  groupByFields: string[];
}

const ALLOWED_SORT_COLUMNS = new Set(['createdAt', 'updatedAt', 'externalId', 'label']);

const FILTER_TO_SQL: Record<FilterOperator, string> = {
  eq: '=',
  neq: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  contains: 'LIKE',
  in: 'IN',
};

@Injectable()
export class QueryPlannerService {
  constructor(private readonly viewLoader: OntologyViewLoader) {}

  async plan(args: PlanArgs): Promise<PlannedQuery> {
    const view = await this.viewLoader.load(args.tenantId, args.objectType);

    const scope = parentScope({ tenantId: args.tenantId, objectType: args.objectType });
    const scopePrefix = emitScope(scope);
    const params: unknown[] = [...scopePrefix.params];
    const wherePieces: string[] = [
      scopePrefix.sql.replace(/^FROM object_instances WHERE /, ''),
    ];

    if (args.search) {
      wherePieces.push(`search_text ILIKE $${params.push('%' + args.search + '%')}`);
    }

    for (const f of args.filters ?? []) {
      wherePieces.push(this.compileFilter(f, view, args.objectType, params));
    }

    const effectivePermissionFilter = this.appendPermissionPredicates(
      args.permissionPredicates ?? [],
      wherePieces,
      params,
    );

    const { sortClause, sortFallbackReason } = this.resolveSort(args.sort, view);

    const where = wherePieces.join(' AND ');
    const sql = `
      SELECT id, tenant_id AS "tenantId", object_type AS "objectType",
             external_id AS "externalId", label, properties, relationships,
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM object_instances
      WHERE ${where}
      ORDER BY ${sortClause}
      OFFSET ${args.skip} LIMIT ${args.take}
    `;
    const countSql = `SELECT COUNT(*)::int AS count FROM object_instances WHERE ${where}`;
    return {
      sql,
      params,
      countSql,
      effectivePermissionFilter,
      sortFallbackReason,
    };
  }

  /**
   * Plans an aggregate query. Reuses the same scope / filter / permission
   * compile pipeline as `plan()`; differs in the SELECT clause and skips
   * include / sort / pagination.
   *
   * v1 (slice #40) supports count-only with no groupBy. The interface is
   * forward-compatible: groupBy / orderBy / maxGroups are read but treated
   * as inert here. Subsequent slices (#41–#44) populate the real behavior
   * by extending the SELECT/GROUP BY/ORDER BY/LIMIT clause builders only.
   */
  async planAggregate(args: AggregatePlanArgs): Promise<PlannedAggregateQuery> {
    const view = await this.viewLoader.load(args.tenantId, args.objectType);

    const scope = parentScope({ tenantId: args.tenantId, objectType: args.objectType });
    const scopePrefix = emitScope(scope);
    const params: unknown[] = [...scopePrefix.params];
    const wherePieces: string[] = [
      scopePrefix.sql.replace(/^FROM object_instances WHERE /, ''),
    ];

    for (const f of args.filters ?? []) {
      wherePieces.push(this.compileFilter(f, view, args.objectType, params));
    }

    const effectivePermissionFilter = this.appendPermissionPredicates(
      args.permissionPredicates ?? [],
      wherePieces,
      params,
    );

    // groupBy validation: each field must be filterable on the view.
    // Non-filterable / json-typed fields (e.g. tags) cannot be grouped on;
    // emit PROPERTY_NOT_GROUPABLE so the agent can fall back to search.
    const groupBy = args.groupBy ?? [];
    if (view) {
      for (const field of groupBy) {
        if (view.filterableFields.size > 0 && !view.filterableFields.has(field)) {
          throw new BadRequestException({
            error: {
              code: 'PROPERTY_NOT_GROUPABLE',
              property: field,
              objectType: args.objectType,
              hint: `Property '${field}' is not groupable. json/array properties cannot be group keys; if you wanted to filter by it, try the 'search' parameter on query_objects instead.`,
            },
          });
        }
      }
    }

    const groupExprs = groupBy.map((f) => `(properties->>'${f}')`);

    // Metric SELECT clauses — slice #40 only handles 'count'.
    const selectExprs: string[] = [];
    // groupBy fields appear in SELECT first so the service layer can read
    // them keyed by the original property name.
    for (let i = 0; i < groupBy.length; i++) {
      selectExprs.push(`${groupExprs[i]} AS "${groupBy[i]}"`);
    }
    for (const m of args.metrics) {
      if (m.kind === 'count') {
        selectExprs.push(`count(*)::int AS "${m.alias}"`);
      } else {
        throw new Error(`metric kind '${m.kind}' not yet supported in v1`);
      }
    }

    const where = wherePieces.join(' AND ');
    const groupByClause = groupBy.length > 0
      ? `GROUP BY ${groupExprs.join(', ')}`
      : '';

    const sql = `
      SELECT ${selectExprs.join(', ')}
      FROM object_instances
      WHERE ${where}
      ${groupByClause}
    `;

    return { sql, params, effectivePermissionFilter, groupByFields: groupBy };
  }

  private compileFilter(
    f: QueryFilter,
    view: OntologyView | null,
    objectTypeName: string,
    params: unknown[],
  ): string {
    if (f.derivedProperty) {
      if (!view) throw new BadRequestException(`Unknown derived property: ${f.derivedProperty}`);
      const def = view.derivedProperties.get(f.derivedProperty);
      if (!def) throw new BadRequestException(`Unknown derived property: ${f.derivedProperty}`);
      const fragment = compile(parse(def.expression), {
        numericFields: view.numericFields,
        booleanFields: view.booleanFields,
        stringFields: view.stringFields,
        relations: view.relations,
        params: f.params ?? {},
      });
      const remapped = this.mergeFragment(fragment, params);
      // eq/neq against null on derived properties: emit IS NULL / IS NOT NULL.
      if (f.value === null && (f.operator === 'eq' || f.operator === 'neq')) {
        return `(${remapped}) IS ${f.operator === 'eq' ? '' : 'NOT '}NULL`;
      }
      const opSql = FILTER_TO_SQL[f.operator];
      params.push(f.value);
      return `(${remapped}) ${opSql} $${params.length}`;
    }

    if (!f.field) {
      throw new BadRequestException('Filter must have either field or derivedProperty');
    }

    if (view && view.filterableFields.size > 0 && !view.filterableFields.has(f.field)) {
      throw new BadRequestException({
        code: 'PROPERTY_NOT_FILTERABLE',
        property: f.field,
        objectType: objectTypeName,
        hint: `Ask the admin to flag '${f.field}' as filterable on '${objectTypeName}'.`,
      });
    }

    const lhs = view?.numericFields.has(f.field)
      ? `(properties->>'${f.field}')::numeric`
      : `properties->>'${f.field}'`;

    // Bug #34: eq/neq against null must compile to IS NULL / IS NOT NULL.
    // `<expr> = NULL` and `<expr> <> NULL` both evaluate to NULL in SQL's
    // three-valued logic and silently filter every row out.
    // For numeric fields we also need to check the raw jsonb extraction,
    // not the ::numeric cast (which would throw on null or invalid text).
    if (f.value === null && (f.operator === 'eq' || f.operator === 'neq')) {
      const nullCheckLhs = `properties->>'${f.field}'`;
      return `${nullCheckLhs} IS ${f.operator === 'eq' ? '' : 'NOT '}NULL`;
    }

    // Bug #35: contains must wrap the value in %...% and use ILIKE for
    // case-insensitive substring matching. The raw value is escaped so that
    // user-provided % and _ are treated as literal characters.
    if (f.operator === 'contains') {
      const escaped = String(f.value).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      params.push(`%${escaped}%`);
      // ILIKE on text is fine; on ::numeric it would error, but contains
      // on numeric properties is ill-defined so we use the raw text LHS.
      const textLhs = `properties->>'${f.field}'`;
      return `${textLhs} ILIKE $${params.length}`;
    }

    const opSql = FILTER_TO_SQL[f.operator];
    params.push(f.value);
    return `${lhs} ${opSql} $${params.length}`;
  }

  private appendPermissionPredicates(
    predicates: Predicate[],
    wherePieces: string[],
    params: unknown[],
  ): string | null {
    if (!predicates.length) return null;
    const effectiveForAudit: string[] = [];
    for (const predicate of predicates) {
      const fragment = emit(predicate);
      wherePieces.push(this.mergeFragment(fragment, params));
      effectiveForAudit.push(JSON.stringify({
        ast: predicate.ast,
        params: predicate.params,
      }));
    }
    return effectiveForAudit.join(' AND ');
  }

  private mergeFragment(
    fragment: { sql: string; params: unknown[] },
    params: unknown[],
  ): string {
    const offset = params.length;
    const remapped = fragment.sql.replace(/\$(\d+)/g, (_m, idx) => `$${Number(idx) + offset}`);
    for (const p of fragment.params) params.push(p);
    return remapped;
  }

  private resolveSort(
    sort: { field: string; direction: 'asc' | 'desc' } | undefined,
    view: OntologyView | null,
  ): { sortClause: string; sortFallbackReason?: string } {
    if (!sort) return { sortClause: 'created_at DESC' };
    if (ALLOWED_SORT_COLUMNS.has(sort.field)) {
      return { sortClause: buildSort(sort, false) };
    }
    if (view?.sortableFields.has(sort.field)) {
      const isNumeric = view.numericFields.has(sort.field);
      return { sortClause: buildSort(sort, isNumeric) };
    }
    return {
      sortClause: 'created_at DESC',
      sortFallbackReason: `Property '${sort.field}' is not flagged sortable; sorted by createdAt instead.`,
    };
  }
}

// Bug #33: numeric properties must be cast to ::numeric before comparing,
// otherwise Postgres sorts lexicographically ('9' > '50'). Additionally we
// append NULLS LAST so the agent's "top item" intuition is stable in both
// directions — null-valued rows never crowd out real values at either end.
function buildSort(sort: { field: string; direction: 'asc' | 'desc' }, isNumericProperty: boolean): string {
  const dir = sort.direction === 'asc' ? 'ASC' : 'DESC';
  if (ALLOWED_SORT_COLUMNS.has(sort.field)) {
    const col = sort.field === 'createdAt' ? 'created_at'
      : sort.field === 'updatedAt' ? 'updated_at'
        : sort.field === 'externalId' ? 'external_id'
          : 'label';
    return `${col} ${dir}`;
  }
  const expr = isNumericProperty
    ? `(properties->>'${sort.field}')::numeric`
    : `(properties->>'${sort.field}')`;
  return `${expr} ${dir} NULLS LAST`;
}
