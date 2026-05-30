import { BadRequestException, Injectable } from '@nestjs/common';
import { parentScope } from '@omaha/dsl';
import type { Predicate, OntologyView } from '@omaha/dsl';
import type { QueryFilter } from '@omaha/shared-types';
import { ScopedWhere } from './scoped-where';
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
    const scoped = new ScopedWhere(scope, { useView })
      .search(args.search)
      .filters(args.filters, view, args.objectType)
      .predicates(args.permissionPredicates);
    const { where, params, effectivePermissionFilter } = scoped.build();

    const { sortClause, sortFallbackReason } = this.resolveSort(args.sort, view);

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
    // Cross-relationship group keys carry a dot: "relationName.field". If any
    // groupBy entry is cross-rel, delegate to the join planner. Local-only
    // aggregation keeps the original single-table path untouched.
    const groupByRaw = args.groupBy ?? [];
    if (groupByRaw.some((g) => typeof g === 'string' && g.includes('.'))) {
      return this.planCrossRelAggregate(args);
    }

    const view = await this.viewLoader.load(args.tenantId, args.objectType);

    const scope = parentScope({ tenantId: args.tenantId, objectType: args.objectType });
    const scoped = new ScopedWhere(scope)
      .filters(args.filters, view, args.objectType)
      .predicates(args.permissionPredicates);
    const { where, params, effectivePermissionFilter } = scoped.build();

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

  /**
   * Cross-relationship aggregate (ADR-0027). A groupBy entry "relationName.field"
   * groups the base type by a field that lives on a *related* type. We isolate
   * the base type's scoped/filtered rows in a subquery (so the existing
   * ScopedWhere column references stay unambiguous, zero changes there) and JOIN
   * to the related instances on the JSONB foreign key.
   *
   * v1 scope: exactly one cross-rel relation per query, joined as the base type's
   * parent (fkSide='self'; the base row holds relationships->>'<rel>' =
   * parentExternalId). Local groupBy keys may be mixed in. Metrics/filters apply
   * to the base type.
   */
  private async planCrossRelAggregate(args: AggregatePlanArgs): Promise<PlannedAggregateQuery> {
    const view = await this.viewLoader.load(args.tenantId, args.objectType);
    const groupByRaw = args.groupBy ?? [];

    // Partition local vs cross-rel keys.
    const localKeys: string[] = [];
    const crossKeys: Array<{ raw: string; relation: string; field: string }> = [];
    for (const g of groupByRaw) {
      if (typeof g === 'string' && g.includes('.')) {
        const dot = g.indexOf('.');
        crossKeys.push({ raw: g, relation: g.slice(0, dot), field: g.slice(dot + 1) });
      } else if (typeof g === 'string') {
        localKeys.push(g);
      }
    }
    if (crossKeys.length > 1) {
      throw new BadRequestException({
        error: {
          code: 'MULTI_CROSS_REL_NOT_SUPPORTED',
          hint: 'Only one cross-relationship group key is supported per query.',
        },
      });
    }
    const cross = crossKeys[0];

    // Resolve the relation by name (direction-agnostic) → other type + storage key.
    const resolved = await this.viewLoader.resolveRelationByName(args.tenantId, args.objectType, cross.relation);
    if (!resolved) {
      throw new BadRequestException({
        error: {
          code: 'UNKNOWN_RELATION',
          relation: cross.relation,
          objectType: args.objectType,
          hint: `'${cross.relation}' is not a relationship on '${args.objectType}'. Use a relation name shown in the schema (e.g. "relationName.field").`,
        },
      });
    }
    if (resolved.fkSide !== 'self') {
      // The base type is the parent (one-side); the FK lives on the child. v1
      // only joins to the parent. Reject clearly rather than emit wrong SQL.
      throw new BadRequestException({
        error: {
          code: 'CROSS_REL_DIRECTION_UNSUPPORTED',
          relation: cross.relation,
          hint: `Cross-relationship grouping from '${args.objectType}' via '${cross.relation}' is only supported toward the parent side in v1.`,
        },
      });
    }

    // Validate the related field is groupable on the OTHER type's view.
    const otherView = await this.viewLoader.load(args.tenantId, resolved.otherType);
    if (otherView && otherView.filterableFields.size > 0 && !otherView.filterableFields.has(cross.field)) {
      throw new BadRequestException({
        error: {
          code: 'PROPERTY_NOT_GROUPABLE',
          property: cross.field,
          objectType: resolved.otherType,
          hint: `Property '${cross.field}' is not groupable on related type '${resolved.otherType}'.`,
        },
      });
    }
    // Validate local groupBy keys against the base view (same rule as planAggregate).
    if (view) {
      for (const lk of localKeys) {
        if (view.filterableFields.size > 0 && !view.filterableFields.has(lk)) {
          throw new BadRequestException({
            error: {
              code: 'PROPERTY_NOT_GROUPABLE',
              property: lk,
              objectType: args.objectType,
              hint: `Property '${lk}' is not groupable on '${args.objectType}'.`,
            },
          });
        }
      }
    }

    return this.buildCrossRelSql(args, view, localKeys, cross, resolved);
  }

  private buildCrossRelSql(
    args: AggregatePlanArgs,
    view: OntologyView | null,
    localKeys: string[],
    cross: { raw: string; relation: string; field: string },
    resolved: { otherType: string; storageKey: string; fkSide: 'self' | 'other' },
  ): PlannedAggregateQuery {
    // Base rows: scoped + filtered in a subquery so existing ScopedWhere column
    // refs (bare `properties`, `tenant_id`, …) stay unambiguous. Expose
    // properties + relationships so the outer query can join and read fields.
    const scope = parentScope({ tenantId: args.tenantId, objectType: args.objectType });
    const scoped = new ScopedWhere(scope)
      .filters(args.filters, view, args.objectType)
      .predicates(args.permissionPredicates);
    const { where, params, effectivePermissionFilter } = scoped.build();

    // Outer params continue numbering after the subquery's params.
    const outParams: unknown[] = [...params];
    const tenantParamIdx = outParams.push(args.tenantId);          // $N for e.tenant_id
    const otherTypeParamIdx = outParams.push(resolved.otherType);  // $N for e.object_type

    // GROUP BY exprs + SELECT aliases. The cross key uses its full dotted path as
    // alias so the service reads it back by the original groupBy string.
    const groupExprs: string[] = [];
    const selectGroupExprs: string[] = [];
    for (const lk of localKeys) {
      groupExprs.push(`(s.properties->>'${lk}')`);
      selectGroupExprs.push(`(s.properties->>'${lk}') AS "${lk}"`);
    }
    const crossExpr = `(e.properties->>'${cross.field}')`;
    groupExprs.push(crossExpr);
    selectGroupExprs.push(`${crossExpr} AS "${cross.raw}"`);

    // Metric SELECTs (operate on base rows, prefixed s.).
    const numericKinds = new Set(['sum', 'avg', 'min', 'max']);
    const metricExprs: string[] = [];
    for (const m of args.metrics) {
      if (m.kind === 'count') { metricExprs.push(`count(*)::int AS "${m.alias}"`); continue; }
      if (m.kind === 'countDistinct') {
        if (!m.field) throw new BadRequestException({ error: { code: 'METRIC_INVALID_FIELD_TYPE', alias: m.alias, hint: `'countDistinct' requires a 'field'.` } });
        metricExprs.push(`count(DISTINCT (s.properties->>'${m.field}'))::int AS "${m.alias}"`);
        continue;
      }
      if (numericKinds.has(m.kind)) {
        if (!m.field) throw new BadRequestException({ error: { code: 'METRIC_INVALID_FIELD_TYPE', alias: m.alias, hint: `Metric kind '${m.kind}' requires a 'field'.` } });
        if (view && view.numericFields.size > 0 && !view.numericFields.has(m.field)) {
          const numericList = Array.from(view.numericFields).join(', ') || '(none declared)';
          throw new BadRequestException({ error: { code: 'METRIC_INVALID_FIELD_TYPE', alias: m.alias, field: m.field, kind: m.kind, hint: `Metric '${m.kind}' requires a numeric property. Available numeric fields on '${args.objectType}': ${numericList}.` } });
        }
        metricExprs.push(`${m.kind.toUpperCase()}((s.properties->>'${m.field}')::numeric) AS "${m.alias}"`);
        continue;
      }
      throw new Error(`metric kind '${m.kind}' not supported in cross-rel v1`);
    }
    // orderBy (single key; same validation contract as planAggregate).
    const allGroupByOut = [...localKeys, cross.raw];
    let orderByClause = '';
    if ((args.orderBy ?? []).length > 1) {
      throw new BadRequestException({ error: { code: 'MULTI_KEY_SORT_NOT_SUPPORTED', hint: 'Provide at most one orderBy entry.' } });
    }
    const ob = (args.orderBy ?? [])[0];
    if (ob) {
      const dir = ob.direction === 'asc' ? 'ASC' : 'DESC';
      if (ob.kind === 'metric') {
        const aliases = args.metrics.map((m) => m.alias);
        if (!aliases.includes(ob.by)) throw new BadRequestException({ error: { code: 'UNKNOWN_METRIC_ALIAS', alias: ob.by, validAliases: aliases, hint: `orderBy.by '${ob.by}' is not a metric alias.` } });
        orderByClause = `ORDER BY "${ob.by}" ${dir} NULLS LAST`;
      } else {
        if (!allGroupByOut.includes(ob.by)) throw new BadRequestException({ error: { code: 'UNKNOWN_METRIC_ALIAS', alias: ob.by, hint: `orderBy.by '${ob.by}' is a groupKey but not in groupBy.` } });
        orderByClause = `ORDER BY "${ob.by}" ${dir} NULLS LAST`;
      }
    }

    const MAX_GROUPS_DEFAULT = 100;
    const MAX_GROUPS_HARD_CAP = 500;
    const requested = args.maxGroups ?? MAX_GROUPS_DEFAULT;
    const clamped = Math.min(requested, MAX_GROUPS_HARD_CAP);
    const warnings: string[] = [];
    if (requested > MAX_GROUPS_HARD_CAP) warnings.push(`maxGroups clamped from ${requested} to ${MAX_GROUPS_HARD_CAP}`);

    let offset = 0;
    if (args.pageToken) {
      try {
        const decoded = JSON.parse(Buffer.from(args.pageToken, 'base64').toString('utf8'));
        if (typeof decoded.offset === 'number') offset = decoded.offset;
      } catch {
        throw new BadRequestException({ error: { code: 'STALE_PAGE_TOKEN', hint: 'pageToken is malformed; restart pagination.' } });
      }
    }

    const sql = `
      SELECT ${[...selectGroupExprs, ...metricExprs].join(', ')}
      FROM (SELECT properties, relationships FROM object_instances WHERE ${where}) s
      JOIN object_instances e
        ON e.external_id = (s.relationships->>'${resolved.storageKey}')
       AND e.tenant_id = $${tenantParamIdx}::uuid
       AND e.object_type = $${otherTypeParamIdx}
      GROUP BY ${groupExprs.join(', ')}
      ${orderByClause}
      OFFSET ${offset} LIMIT ${clamped + 1}
    `;

    return {
      sql,
      params: outParams,
      effectivePermissionFilter,
      groupByFields: allGroupByOut,
      maxGroups: clamped,
      offset,
      warnings,
    };
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
