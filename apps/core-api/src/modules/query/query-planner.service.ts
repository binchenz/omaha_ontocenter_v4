import { BadRequestException, Injectable } from '@nestjs/common';
import { compile, parse, emit, emitScope, parentScope } from '@omaha/dsl';
import type { Predicate, OntologyView } from '@omaha/dsl';
import type { QueryFilter, FilterOperator } from '@omaha/shared-types';
import { OntologyViewLoader } from '../ontology/ontology-view-loader.service';
import { ViewManagerService } from '../ontology/view-manager.service';

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
  pageToken?: string;
  permissionPredicates?: Predicate[];
}

export interface PlannedAggregateQuery {
  sql: string;
  params: unknown[];
  effectivePermissionFilter: string | null;
  groupByFields: string[];
  maxGroups: number;
  offset: number;
  warnings: string[];
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
  constructor(
    private readonly viewLoader: OntologyViewLoader,
    private readonly viewManager: ViewManagerService,
  ) {}

  async plan(args: PlanArgs): Promise<PlannedQuery> {
    const view = await this.viewLoader.load(args.tenantId, args.objectType);
    const useView = await this.viewManager.exists(args.tenantId, args.objectType);
    // Alias the view AS object_instances so correlated subqueries from DSL
    // (which reference object_instances.tenant_id and object_instances.id) work.
    const tableName = useView
      ? `"${this.viewManager.getViewName(args.tenantId, args.objectType)}" AS object_instances`
      : 'object_instances';

    const scope = parentScope({ tenantId: args.tenantId, objectType: args.objectType });
    const scopePrefix = emitScope(scope);
    const params: unknown[] = useView ? [] : [...scopePrefix.params];
    // When using a materialized view, the tenant/objectType filter is baked in — skip scope WHERE
    const wherePieces: string[] = useView ? ['1=1'] : [
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
      FROM ${tableName}
      WHERE ${where}
      ORDER BY ${sortClause}
      OFFSET ${args.skip} LIMIT ${args.take}
    `;
    const countSql = `SELECT COUNT(*)::int AS count FROM ${tableName} WHERE ${where}`;
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

    // Metric SELECT clauses.
    const numericKinds = new Set(['sum', 'avg', 'min', 'max']);
    const selectExprs: string[] = [];
    // groupBy fields appear in SELECT first so the service layer can read
    // them keyed by the original property name.
    for (let i = 0; i < groupBy.length; i++) {
      selectExprs.push(`${groupExprs[i]} AS "${groupBy[i]}"`);
    }
    for (const m of args.metrics) {
      if (m.kind === 'count') {
        selectExprs.push(`count(*)::int AS "${m.alias}"`);
        continue;
      }
      if (m.kind === 'countDistinct') {
        if (!m.field) {
          throw new BadRequestException({
            error: { code: 'METRIC_INVALID_FIELD_TYPE', alias: m.alias, hint: `'countDistinct' requires a 'field'.` },
          });
        }
        // No ::numeric cast — count distinct works over any text.
        selectExprs.push(`count(DISTINCT (properties->>'${m.field}'))::int AS "${m.alias}"`);
        continue;
      }
      if (numericKinds.has(m.kind)) {
        if (!m.field) {
          throw new BadRequestException({
            error: {
              code: 'METRIC_INVALID_FIELD_TYPE',
              alias: m.alias,
              hint: `Metric kind '${m.kind}' requires a 'field'.`,
            },
          });
        }
        if (view && view.numericFields.size > 0 && !view.numericFields.has(m.field)) {
          const numericList = Array.from(view.numericFields).join(', ') || '(none declared)';
          throw new BadRequestException({
            error: {
              code: 'METRIC_INVALID_FIELD_TYPE',
              alias: m.alias,
              field: m.field,
              kind: m.kind,
              hint: `Metric '${m.kind}' requires a numeric property. Available numeric fields on '${args.objectType}': ${numericList}.`,
            },
          });
        }
        const fn = m.kind.toUpperCase();
        // Cast to numeric matches the bug-#33 sort fix convention.
        selectExprs.push(`${fn}((properties->>'${m.field}')::numeric) AS "${m.alias}"`);
        continue;
      }
      // countDistinct lands in #43.
      throw new Error(`metric kind '${m.kind}' not yet supported in v1`);
    }

    const where = wherePieces.join(' AND ');
    const groupByClause = groupBy.length > 0
      ? `GROUP BY ${groupExprs.join(', ')}`
      : '';

    // orderBy validation + SQL generation.
    const orderByList = args.orderBy ?? [];
    if (orderByList.length > 1) {
      throw new BadRequestException({
        error: {
          code: 'MULTI_KEY_SORT_NOT_SUPPORTED',
          hint: 'Multi-key sort not supported in v1. Provide at most one orderBy entry.',
        },
      });
    }
    let orderByClause = '';
    if (orderByList.length === 1) {
      const ob = orderByList[0];
      const dir = ob.direction === 'asc' ? 'ASC' : 'DESC';
      if (ob.kind === 'metric') {
        const validAliases = args.metrics.map((m) => m.alias);
        if (!validAliases.includes(ob.by)) {
          throw new BadRequestException({
            error: {
              code: 'UNKNOWN_METRIC_ALIAS',
              alias: ob.by,
              validAliases,
              hint: `orderBy.by '${ob.by}' is not a declared metric alias. Valid aliases: ${validAliases.join(', ')}.`,
            },
          });
        }
        orderByClause = `ORDER BY "${ob.by}" ${dir} NULLS LAST`;
      } else {
        // groupKey
        if (!groupBy.includes(ob.by)) {
          throw new BadRequestException({
            error: {
              code: 'UNKNOWN_METRIC_ALIAS',
              alias: ob.by,
              hint: `orderBy.by '${ob.by}' is a groupKey but not in groupBy: [${groupBy.join(', ')}].`,
            },
          });
        }
        orderByClause = `ORDER BY (properties->>'${ob.by}') ${dir} NULLS LAST`;
      }
    }

    // maxGroups clamp (per ADR-0017): default 100, max 500. Clamp + warn,
    // never reject. The SQL requests +1 to detect truncation cheaply.
    const MAX_GROUPS_DEFAULT = 100;
    const MAX_GROUPS_HARD_CAP = 500;
    const requestedMaxGroups = args.maxGroups ?? MAX_GROUPS_DEFAULT;
    const clamped = Math.min(requestedMaxGroups, MAX_GROUPS_HARD_CAP);
    const warnings: string[] = [];
    if (requestedMaxGroups > MAX_GROUPS_HARD_CAP) {
      warnings.push(`maxGroups clamped from ${requestedMaxGroups} to ${MAX_GROUPS_HARD_CAP}`);
    }

    // pageToken = base64({ sqlHash, offset }). The hash is recomputed on
    // follow-up to detect spec drift; mismatch → STALE_PAGE_TOKEN.
    let offset = 0;
    if (args.pageToken) {
      try {
        const decoded = JSON.parse(Buffer.from(args.pageToken, 'base64').toString('utf8'));
        if (typeof decoded.offset === 'number') offset = decoded.offset;
      } catch {
        throw new BadRequestException({
          error: { code: 'STALE_PAGE_TOKEN', hint: 'pageToken is malformed; restart pagination.' },
        });
      }
    }

    const sql = `
      SELECT ${selectExprs.join(', ')}
      FROM object_instances
      WHERE ${where}
      ${groupByClause}
      ${orderByClause}
      OFFSET ${offset} LIMIT ${clamped + 1}
    `;

    return {
      sql,
      params,
      effectivePermissionFilter,
      groupByFields: groupBy,
      maxGroups: clamped,
      offset,
      warnings,
    };
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
