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
  constructor(private readonly prisma: PrismaService) {}

  async plan(args: {
    tenantId: string;
    objectType: string;
    filters?: QueryFilter[];
    search?: string;
    sort?: { field: string; direction: 'asc' | 'desc' };
    skip: number;
    take: number;
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
    const derivedByName = new Map(derived.map((d) => [d.name, d]));

    let relationsMap: Record<string, { foreignKey: string }> = {};
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

    const where = wherePieces.join(' AND ');
    const sortClause = buildSort(args.sort);
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
    return { sql, params, countSql };
  }
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
