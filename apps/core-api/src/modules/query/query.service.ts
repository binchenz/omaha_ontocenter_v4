import { Injectable, BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '@omaha/db';
import { PermissionResolver } from '../permission/permission-resolver.service';
import {
  CurrentUser as CurrentUserType,
  QueryObjectsRequest,
  QueryObjectsResponse,
} from '@omaha/shared-types';
import { QueryPlannerService, PermissionTemplateVars } from './query-planner.service';
import { filterMaskedFields } from '../../common/filter-masked-fields';

interface RawInstanceRow {
  id: string;
  tenantId: string;
  objectType: string;
  externalId: string;
  label: string | null;
  properties: unknown;
  relationships: unknown;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class QueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionResolver: PermissionResolver,
    private readonly planner: QueryPlannerService,
  ) {}

  async queryObjects(
    user: CurrentUserType,
    req: QueryObjectsRequest,
  ): Promise<QueryObjectsResponse> {
    const resolution = await this.permissionResolver.resolveOrThrow(
      user,
      'object',
      'read',
      req.objectType,
    );

    const page = req.page ?? 1;
    const pageSize = Math.min(req.pageSize ?? 20, 100);
    const skip = (page - 1) * pageSize;

    const permissionConditions: string[] = [];
    for (const rule of user.permissionRules ?? []) {
      const base = rule.permission.split(':')[0];
      const [res, act] = base.split('.');
      if (res === 'object' && (act === '*' || act === 'read') && rule.condition) {
        permissionConditions.push(rule.condition);
      }
    }

    const templateVars: PermissionTemplateVars = {
      userId: user.id,
      userRoleId: user.roleId,
      userTenantId: user.tenantId,
      now: new Date().toISOString(),
    };

    const planned = await this.planner.plan({
      tenantId: user.tenantId,
      objectType: req.objectType,
      filters: req.filters,
      search: req.search,
      sort: req.sort,
      skip,
      take: pageSize,
      permissionConditions,
      templateVars,
    });

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<RawInstanceRow[]>(planned.sql, ...planned.params),
      this.prisma.$queryRawUnsafe<{ count: number }[]>(planned.countSql, ...planned.params),
    ]);
    const total = Number(countRows[0]?.count ?? 0);

    const includes = await this.resolveIncludes(user.tenantId, req.objectType, req.include ?? []);
    const includedByParent = await this.fetchIncludes(user.tenantId, rows.map((r) => r.id), includes);

    const data = rows.map((inst) => {
      const properties = filterMaskedFields(
        (inst.properties ?? {}) as Record<string, unknown>,
        resolution.allowedFields,
      );
      const projected = req.select && req.select.length > 0
        ? Object.fromEntries(req.select.filter((k) => k in properties).map((k) => [k, properties[k]]))
        : properties;

      const relationships: Record<string, unknown> = {};
      for (const inc of includes) {
        relationships[inc.name] = includedByParent[inst.id]?.[inc.name] ?? [];
      }

      return {
        id: inst.id,
        objectType: inst.objectType,
        externalId: inst.externalId,
        label: inst.label,
        properties: projected,
        relationships,
        createdAt: inst.createdAt.toISOString(),
        updatedAt: inst.updatedAt.toISOString(),
      };
    });

    const compiledSqlHash = createHash('sha256').update(planned.sql).digest('hex').slice(0, 32);

    await this.prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        actorId: user.id,
        actorType: 'user',
        operation: 'object.query',
        objectType: req.objectType,
        queryPlan: req as unknown as object,
        resultCount: total,
        source: 'api',
        effectivePermissionFilter: planned.effectivePermissionFilter ?? undefined,
        compiledSqlHash,
      },
    });

    return {
      data,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize) || 0,
        objectType: req.objectType,
        ...(planned.sortFallbackReason && { sortFallbackReason: planned.sortFallbackReason }),
      },
    };
  }

  private async resolveIncludes(
    tenantId: string,
    objectType: string,
    include: string[],
  ): Promise<Array<{ name: string; targetType: string; foreignKey: string }>> {
    if (!include.length) return [];
    const ot = await this.prisma.objectType.findFirst({ where: { tenantId, name: objectType } });
    if (!ot) return [];
    const rels = await this.prisma.objectRelationship.findMany({
      where: { tenantId, sourceTypeId: ot.id },
      include: { targetType: { select: { name: true } } },
    });
    const out: Array<{ name: string; targetType: string; foreignKey: string }> = [];
    for (const name of include) {
      const rel = rels.find((r) => r.name === name);
      if (!rel) {
        throw new BadRequestException(`Unknown relationship in include: ${name}`);
      }
      out.push({ name, targetType: rel.targetType.name, foreignKey: `${ot.name}Id` });
    }
    return out;
  }

  private async fetchIncludes(
    tenantId: string,
    parentIds: string[],
    includes: Array<{ name: string; targetType: string; foreignKey: string }>,
  ): Promise<Record<string, Record<string, unknown[]>>> {
    if (!parentIds.length || !includes.length) return {};
    const out: Record<string, Record<string, unknown[]>> = {};
    for (const id of parentIds) out[id] = {};

    for (const inc of includes) {
      const children = await this.prisma.$queryRawUnsafe<RawInstanceRow[]>(
        `SELECT id, tenant_id AS "tenantId", object_type AS "objectType",
                external_id AS "externalId", label, properties, relationships,
                created_at AS "createdAt", updated_at AS "updatedAt"
         FROM object_instances
         WHERE tenant_id = $1::uuid AND object_type = $2 AND deleted_at IS NULL
           AND (relationships->>$3) = ANY($4::text[])`,
        tenantId,
        inc.targetType,
        inc.foreignKey,
        parentIds,
      );
      for (const c of children) {
        const parentId = (c.relationships as Record<string, unknown> | null)?.[inc.foreignKey] as string | undefined;
        if (!parentId) continue;
        const bucket = out[parentId];
        if (!bucket) continue;
        if (!bucket[inc.name]) bucket[inc.name] = [];
        bucket[inc.name].push({
          id: c.id,
          objectType: c.objectType,
          externalId: c.externalId,
          label: c.label,
          properties: (c.properties ?? {}) as Record<string, unknown>,
        });
      }
    }
    return out;
  }
}
