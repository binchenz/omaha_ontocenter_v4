import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { compile, parse } from '@omaha/dsl';
import {
  PropertyDefinition,
  DerivedPropertyDefinition,
  QueryFilter,
  FilterOperator,
} from '@omaha/shared-types';

export interface PlannedQuery {
  sql: string;
  params: unknown[];
  countSql: string;
  effectivePermissionFilter: string | null;
  sortFallbackReason?: string;
}

export interface PermissionTemplateVars {
  userId: string;
  userRoleId: string;
  userTenantId: string;
  now: string;
}

const TEMPLATE_WHITELIST = new Set(['userId', 'userRoleId', 'userTenantId', 'now']);

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
  constructor(private readonly prisma: PrismaService) {}

  async plan(args: {
    tenantId: string;
    objectType: string;
    filters?: QueryFilter[];
    search?: string;
    sort?: { field: string; direction: 'asc' | 'desc' };
    skip: number;
    take: number;
    permissionConditions?: string[];
    templateVars?: PermissionTemplateVars;
  }): Promise<PlannedQuery> {
    const ot = await this.prisma.objectType.findFirst({
      where: { tenantId: args.tenantId, name: args.objectType },
    });

    const properties = (ot?.properties ?? []) as unknown as PropertyDefinition[];
    const derived = (ot?.derivedProperties ?? []) as unknown as DerivedPropertyDefinition[];
    const numericFields = new Set(
      properties.filter((p) => p.type === 'number').map((p) => p.name),
    );
    const booleanFields = new Set(
      properties.filter((p) => p.type === 'boolean').map((p) => p.name),
    );
    const filterableFields = new Set(properties.filter((p) => p.filterable).map((p) => p.name));
    const sortableFields = new Set(properties.filter((p) => p.sortable).map((p) => p.name));
    const derivedByName = new Map(derived.map((d) => [d.name, d]));

    const relationsMap: Record<string, { foreignKey: string }> = {};
    if (ot) {
      const rels = await this.prisma.objectRelationship.findMany({
        where: { tenantId: args.tenantId, sourceTypeId: ot.id },
        select: { name: true, targetType: { select: { name: true } } },
      });
      for (const r of rels) {
        relationsMap[r.name] = { foreignKey: `${ot.name}Id` };
      }
    }

    const params: unknown[] = [];
    const wherePieces: string[] = [
      `tenant_id = $${params.push(args.tenantId)}::uuid`,
      `object_type = $${params.push(args.objectType)}`,
      `deleted_at IS NULL`,
    ];

    if (args.search) {
      wherePieces.push(`search_text ILIKE $${params.push('%' + args.search + '%')}`);
    }

    for (const f of args.filters ?? []) {
      if (f.derivedProperty) {
        const def = derivedByName.get(f.derivedProperty);
        if (!def) {
          throw new BadRequestException(`Unknown derived property: ${f.derivedProperty}`);
        }
        const ast = parse(def.expression);
        const fragment = compile(ast, {
          numericFields,
          booleanFields,
          relations: relationsMap,
          params: f.params ?? {},
        });
        const offsetParams = params.length;
        const remappedSql = fragment.sql.replace(/\$(\d+)/g, (_m, idx) => `$${Number(idx) + offsetParams}`);
        for (const p of fragment.params) params.push(p);
        const opSql = FILTER_TO_SQL[f.operator];
        params.push(f.value);
        wherePieces.push(`(${remappedSql}) ${opSql} $${params.length}`);
      } else if (f.field) {
        if (ot && properties.length > 0 && !filterableFields.has(f.field)) {
          throw new BadRequestException({
            code: 'PROPERTY_NOT_FILTERABLE',
            property: f.field,
            objectType: args.objectType,
            hint: `Ask the admin to flag '${f.field}' as filterable on '${args.objectType}'.`,
          });
        }
        const opSql = FILTER_TO_SQL[f.operator];
        const lhs = numericFields.has(f.field)
          ? `(properties->>'${f.field}')::numeric`
          : `properties->>'${f.field}'`;
        params.push(f.value);
        wherePieces.push(`${lhs} ${opSql} $${params.length}`);
      } else {
        throw new BadRequestException('Filter must have either field or derivedProperty');
      }
    }

    const substituted: string[] = [];
    for (const cond of args.permissionConditions ?? []) {
      if (!cond.trim()) continue;
      const sub = substituteTemplates(cond, args.templateVars);
      substituted.push(sub);
      const ast = parse(sub);
      const fragment = compile(ast, {
        numericFields,
        booleanFields,
        relations: relationsMap,
      });
      const offsetParams = params.length;
      const remappedSql = fragment.sql.replace(/\$(\d+)/g, (_m, idx) => `$${Number(idx) + offsetParams}`);
      for (const p of fragment.params) params.push(p);
      wherePieces.push(remappedSql);
    }

    const where = wherePieces.join(' AND ');
    let sortFallbackReason: string | undefined;
    let sortClause: string;
    if (args.sort && ALLOWED_SORT_COLUMNS.has(args.sort.field)) {
      sortClause = buildSort(args.sort);
    } else if (args.sort) {
      sortFallbackReason = sortableFields.has(args.sort.field)
        ? undefined
        : `Property '${args.sort.field}' is not flagged sortable; sorted by createdAt instead.`;
      sortClause = sortableFields.has(args.sort.field)
        ? buildSort(args.sort)
        : 'created_at DESC';
    } else {
      sortClause = 'created_at DESC';
    }
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
      effectivePermissionFilter: substituted.length > 0 ? substituted.join(' AND ') : null,
      sortFallbackReason,
    };
  }
}

function substituteTemplates(src: string, vars?: PermissionTemplateVars): string {
  return src.replace(/:(\w+)/g, (_m, name) => {
    if (!TEMPLATE_WHITELIST.has(name)) {
      return `:${name}`;
    }
    if (!vars) throw new BadRequestException(`Missing template value for :${name}`);
    const key = name as keyof PermissionTemplateVars;
    const value = vars[key];
    if (value === undefined) throw new BadRequestException(`Missing template value for :${name}`);
    return `'${String(value).replace(/'/g, "''")}'`;
  });
}

function buildSort(sort?: { field: string; direction: 'asc' | 'desc' }): string {
  if (!sort) return 'created_at DESC';
  const dir = sort.direction === 'asc' ? 'ASC' : 'DESC';
  if (!ALLOWED_SORT_COLUMNS.has(sort.field)) return `created_at ${dir}`;
  const col = sort.field === 'createdAt' ? 'created_at'
    : sort.field === 'updatedAt' ? 'updated_at'
      : sort.field === 'externalId' ? 'external_id'
        : 'label';
  return `${col} ${dir}`;
}
