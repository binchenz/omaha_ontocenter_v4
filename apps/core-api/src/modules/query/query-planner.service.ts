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
    for (const field of groupBy) this.assertGroupable(field, view, args.objectType);

    const groupExprs = groupBy.map((f) => `(properties->>'${f}')`);

    // groupBy fields appear in SELECT first so the service layer can read
    // them keyed by the original property name.
    const selectExprs: string[] = groupBy.map((f, i) => `${groupExprs[i]} AS "${f}"`);
    selectExprs.push(...this.buildMetricExprs(args.metrics, view, args.objectType, (f) => `properties->>'${f}'`));

    const groupByClause = groupBy.length > 0
      ? `GROUP BY ${groupExprs.join(', ')}`
      : '';

    // orderBy / maxGroups / pageToken via shared builders.
    const orderByClause = this.buildOrderByClause(
      args.orderBy,
      args.metrics.map((m) => m.alias),
      groupBy,
      (by) => `(properties->>'${by}')`,
    );
    const { clamped, warnings } = this.clampMaxGroups(args.maxGroups);
    const offset = this.decodeOffset(args.pageToken);

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
    const groupByRaw = args.groupBy ?? [];

    // Partition local vs cross-rel keys. groupBy is string[]; a dot marks a
    // cross-rel "relationName.field" key. v1 allows at most one cross-rel key.
    const localKeys: string[] = [];
    let cross: { raw: string; relation: string; field: string } | null = null;
    for (const g of groupByRaw) {
      const dot = g.indexOf('.');
      if (dot < 0) {
        localKeys.push(g);
        continue;
      }
      if (cross) {
        throw new BadRequestException({
          error: { code: 'MULTI_CROSS_REL_NOT_SUPPORTED', hint: 'Only one cross-relationship group key is supported per query.' },
        });
      }
      cross = { raw: g, relation: g.slice(0, dot), field: g.slice(dot + 1) };
    }
    // planAggregate only delegates here when a dotted key exists, so cross is
    // always set; assert for type-narrowing and defence-in-depth.
    if (!cross) return this.planAggregate({ ...args, groupBy: localKeys });
    const xkey = cross;

    // Base view + relation resolution are independent — load in parallel.
    const [view, resolved] = await Promise.all([
      this.viewLoader.load(args.tenantId, args.objectType),
      this.viewLoader.resolveRelationByName(args.tenantId, args.objectType, xkey.relation),
    ]);
    if (!resolved) {
      throw new BadRequestException({
        error: {
          code: 'UNKNOWN_RELATION',
          relation: xkey.relation,
          objectType: args.objectType,
          hint: `'${xkey.relation}' is not a relationship on '${args.objectType}'. Use a relation name shown in the schema (e.g. "relationName.field").`,
        },
      });
    }
    if (resolved.fkSide !== 'self') {
      // The base type is the parent (one-side); the FK lives on the child. v1
      // only joins to the parent. Reject clearly rather than emit wrong SQL.
      throw new BadRequestException({
        error: {
          code: 'CROSS_REL_DIRECTION_UNSUPPORTED',
          relation: xkey.relation,
          hint: `Cross-relationship grouping from '${args.objectType}' via '${xkey.relation}' is only supported toward the parent side in v1.`,
        },
      });
    }

    // Validate the related field is groupable on the OTHER type's view, and the
    // local keys on the base view (same rule as planAggregate).
    const otherView = await this.viewLoader.load(args.tenantId, resolved.otherType);
    this.assertGroupable(xkey.field, otherView, resolved.otherType);
    for (const lk of localKeys) this.assertGroupable(lk, view, args.objectType);

    return this.buildCrossRelSql(args, view, localKeys, xkey, {
      otherType: resolved.otherType,
      storageKey: resolved.storageKey,
      fkSide: 'self',
    });
  }

  private buildCrossRelSql(
    args: AggregatePlanArgs,
    view: OntologyView | null,
    localKeys: string[],
    cross: { raw: string; relation: string; field: string },
    resolved: { otherType: string; storageKey: string; fkSide: 'self' },
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

    // GROUP BY exprs + SELECT aliases. Local keys read from base rows (s.), the
    // cross key from the joined related rows (e.). The cross key uses its full
    // dotted path as alias so the service reads it back by the groupBy string.
    const groupExprs = [
      ...localKeys.map((lk) => `(s.properties->>'${lk}')`),
      `(e.properties->>'${cross.field}')`,
    ];
    const allGroupByOut = [...localKeys, cross.raw];
    const selectGroupExprs = groupExprs.map((expr, i) => `${expr} AS "${allGroupByOut[i]}"`);

    // Metrics operate on the base rows (s.); orderBy/maxGroups/pageToken via the
    // shared builders. Cross-key ordering uses the SELECT alias, not the json expr.
    const metricExprs = this.buildMetricExprs(args.metrics, view, args.objectType, (f) => `s.properties->>'${f}'`);
    const orderByClause = this.buildOrderByClause(
      args.orderBy,
      args.metrics.map((m) => m.alias),
      allGroupByOut,
      (by) => `"${by}"`,
    );
    const { clamped, warnings } = this.clampMaxGroups(args.maxGroups);
    const offset = this.decodeOffset(args.pageToken);

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

  /**
   * Shared aggregate-builder helpers (used by both the local `planAggregate`
   * path and the cross-rel `buildCrossRelSql` path). They differ only in the
   * column source, which the callers inject via `propRef` / `groupKeyExpr`.
   */
  private assertGroupable(field: string, view: OntologyView | null, objectType: string): void {
    if (view && view.filterableFields.size > 0 && !view.filterableFields.has(field)) {
      throw new BadRequestException({
        error: {
          code: 'PROPERTY_NOT_GROUPABLE',
          property: field,
          objectType,
          hint: `Property '${field}' is not groupable on '${objectType}'. json/array properties cannot be group keys; if you wanted to filter by it, try the 'search' parameter on query_objects instead.`,
        },
      });
    }
  }

  private buildMetricExprs(
    metrics: AggregateMetric[],
    view: OntologyView | null,
    objectType: string,
    propRef: (field: string) => string,
  ): string[] {
    const numericKinds = new Set(['sum', 'avg', 'min', 'max']);
    const out: string[] = [];
    for (const m of metrics) {
      if (m.kind === 'count') {
        out.push(`count(*)::int AS "${m.alias}"`);
        continue;
      }
      if (!m.field) {
        const hint = m.kind === 'countDistinct'
          ? `'countDistinct' requires a 'field'.`
          : `Metric kind '${m.kind}' requires a 'field'.`;
        throw new BadRequestException({ error: { code: 'METRIC_INVALID_FIELD_TYPE', alias: m.alias, hint } });
      }
      if (m.kind === 'countDistinct') {
        // No ::numeric cast — count distinct works over any text.
        out.push(`count(DISTINCT (${propRef(m.field)}))::int AS "${m.alias}"`);
        continue;
      }
      if (numericKinds.has(m.kind)) {
        if (view && view.numericFields.size > 0 && !view.numericFields.has(m.field)) {
          const numericList = Array.from(view.numericFields).join(', ') || '(none declared)';
          throw new BadRequestException({ error: { code: 'METRIC_INVALID_FIELD_TYPE', alias: m.alias, field: m.field, kind: m.kind, hint: `Metric '${m.kind}' requires a numeric property. Available numeric fields on '${objectType}': ${numericList}.` } });
        }
        // Cast to numeric matches the bug-#33 sort fix convention.
        out.push(`${m.kind.toUpperCase()}((${propRef(m.field)})::numeric) AS "${m.alias}"`);
        continue;
      }
      throw new Error(`metric kind '${m.kind}' not supported`);
    }
    return out;
  }

  /**
   * orderBy validation + ORDER BY clause. A single key only (v1).
   * `metricAliases` are valid for kind:'metric'; `groupKeys` for kind:'groupKey'.
   * `groupKeyExpr` maps a groupKey to its SQL ordering expression — the local
   * path orders by the raw json expr, the cross-rel path by the SELECT alias.
   */
  private buildOrderByClause(
    orderBy: AggregateOrderBy[] | undefined,
    metricAliases: string[],
    groupKeys: string[],
    groupKeyExpr: (by: string) => string,
  ): string {
    const list = orderBy ?? [];
    if (list.length > 1) {
      throw new BadRequestException({
        error: { code: 'MULTI_KEY_SORT_NOT_SUPPORTED', hint: 'Multi-key sort not supported in v1. Provide at most one orderBy entry.' },
      });
    }
    const ob = list[0];
    if (!ob) return '';
    const dir = ob.direction === 'asc' ? 'ASC' : 'DESC';
    if (ob.kind === 'metric') {
      if (!metricAliases.includes(ob.by)) {
        throw new BadRequestException({
          error: { code: 'UNKNOWN_METRIC_ALIAS', alias: ob.by, validAliases: metricAliases, hint: `orderBy.by '${ob.by}' is not a declared metric alias. Valid aliases: ${metricAliases.join(', ')}.` },
        });
      }
      return `ORDER BY "${ob.by}" ${dir} NULLS LAST`;
    }
    if (!groupKeys.includes(ob.by)) {
      throw new BadRequestException({
        error: { code: 'UNKNOWN_METRIC_ALIAS', alias: ob.by, hint: `orderBy.by '${ob.by}' is a groupKey but not in groupBy: [${groupKeys.join(', ')}].` },
      });
    }
    return `ORDER BY ${groupKeyExpr(ob.by)} ${dir} NULLS LAST`;
  }

  // maxGroups clamp (per ADR-0017): default 100, max 500. Clamp + warn, never
  // reject. The SQL requests +1 to detect truncation cheaply.
  private clampMaxGroups(maxGroups: number | undefined): { clamped: number; warnings: string[] } {
    const DEFAULT = 100;
    const HARD_CAP = 500;
    const requested = maxGroups ?? DEFAULT;
    const clamped = Math.min(requested, HARD_CAP);
    const warnings: string[] = [];
    if (requested > HARD_CAP) warnings.push(`maxGroups clamped from ${requested} to ${HARD_CAP}`);
    return { clamped, warnings };
  }

  // pageToken = base64({ offset, … }). Malformed → STALE_PAGE_TOKEN.
  private decodeOffset(pageToken: string | undefined): number {
    if (!pageToken) return 0;
    try {
      const decoded = JSON.parse(Buffer.from(pageToken, 'base64').toString('utf8'));
      return typeof decoded.offset === 'number' ? decoded.offset : 0;
    } catch {
      throw new BadRequestException({ error: { code: 'STALE_PAGE_TOKEN', hint: 'pageToken is malformed; restart pagination.' } });
    }
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
