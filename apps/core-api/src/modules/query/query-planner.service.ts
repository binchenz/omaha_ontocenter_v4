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

    const opSql = FILTER_TO_SQL[f.operator];
    const lhs = view?.numericFields.has(f.field)
      ? `(properties->>'${f.field}')::numeric`
      : `properties->>'${f.field}'`;
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
      return { sortClause: buildSort(sort) };
    }
    if (view?.sortableFields.has(sort.field)) {
      return { sortClause: buildSort(sort) };
    }
    return {
      sortClause: 'created_at DESC',
      sortFallbackReason: `Property '${sort.field}' is not flagged sortable; sorted by createdAt instead.`,
    };
  }
}

function buildSort(sort: { field: string; direction: 'asc' | 'desc' }): string {
  const dir = sort.direction === 'asc' ? 'ASC' : 'DESC';
  if (ALLOWED_SORT_COLUMNS.has(sort.field)) {
    const col = sort.field === 'createdAt' ? 'created_at'
      : sort.field === 'updatedAt' ? 'updated_at'
        : sort.field === 'externalId' ? 'external_id'
          : 'label';
    return `${col} ${dir}`;
  }
  return `(properties->>'${sort.field}') ${dir}`;
}
