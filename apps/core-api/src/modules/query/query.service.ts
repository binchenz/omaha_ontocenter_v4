import { Injectable, BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '@omaha/db';
import { emitScope, parentScope } from '@omaha/dsl';
import { PermissionResolver } from '../permission/permission-resolver.service';
import {
  CurrentUser as CurrentUserType,
  QueryObjectsRequest,
  QueryObjectsResponse,
} from '@omaha/shared-types';
import {
  QueryPlannerService,
  type AggregateMetric,
  type AggregateOrderBy,
} from './query-planner.service';
import { OntologyViewLoader } from '../ontology/ontology-view-loader.service';
import { filterMaskedFields } from '../../common/filter-masked-fields';
import type { QueryFilter } from '@omaha/shared-types';

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

export interface AggregateObjectsRequest {
  objectType: string;
  filters?: QueryFilter[];
  groupBy?: string[];
  metrics?: AggregateMetric[];
  orderBy?: AggregateOrderBy[];
  maxGroups?: number;
  pageToken?: string;
}

export interface AggregationGroup {
  key: Record<string, unknown>;
  metrics: Record<string, number>;
}

export interface AggregationResponse {
  groups: AggregationGroup[];
  truncated: boolean;
  nextPageToken: string | null;
  totalGroupsEstimate: number | null;
  warnings?: string[];
}

@Injectable()
export class QueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionResolver: PermissionResolver,
    private readonly planner: QueryPlannerService,
    private readonly viewLoader: OntologyViewLoader,
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

    const planned = await this.planner.plan({
      tenantId: user.tenantId,
      objectType: req.objectType,
      filters: req.filters,
      search: req.search,
      sort: req.sort,
      skip,
      take: pageSize,
      permissionPredicates: resolution.predicates,
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

  /**
   * Slice #40: count-only aggregate, no groupBy.
   * Forward-shape: returns the full Aggregation envelope so subsequent
   * slices (#41–#44) only enrich metrics/groups/pagination — no consumer
   * change required.
   */
  async aggregateObjects(
    user: CurrentUserType,
    req: AggregateObjectsRequest,
  ): Promise<AggregationResponse> {
    if (!req.metrics || req.metrics.length === 0) {
      throw new BadRequestException({
        error: { code: 'METRICS_REQUIRED', message: 'metrics is required and must be a non-empty array', hint: 'Provide at least one metric, e.g. [{ kind: "count", alias: "n" }].' },
      });
    }
    const metrics = req.metrics;

    const resolution = await this.permissionResolver.resolveOrThrow(
      user,
      'object',
      'read',
      req.objectType,
    );

    const planned = await this.planner.planAggregate({
      tenantId: user.tenantId,
      objectType: req.objectType,
      filters: req.filters,
      groupBy: req.groupBy,
      metrics,
      orderBy: req.orderBy,
      maxGroups: req.maxGroups,
      pageToken: req.pageToken,
      permissionPredicates: resolution.predicates,
    });

    const rows = await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(planned.sql, ...planned.params);

    // Truncation detection: planner requested LIMIT maxGroups+1; if we got
    // back maxGroups+1 rows, there's at least one more group. Trim to
    // maxGroups and emit a pageToken.
    const truncated = rows.length > planned.maxGroups;
    const visibleRows = truncated ? rows.slice(0, planned.maxGroups) : rows;

    const groups = visibleRows.map((row) => {
      const key: Record<string, unknown> = {};
      for (const field of planned.groupByFields) {
        key[field] = row[field];
      }
      const m: Record<string, number> = {};
      for (const metric of metrics) {
        const v = row[metric.alias];
        m[metric.alias] = typeof v === 'bigint' ? Number(v) : (v as number);
      }
      return { key, metrics: m };
    });

    const nextPageToken = truncated
      ? Buffer.from(JSON.stringify({ offset: planned.offset + planned.maxGroups })).toString('base64')
      : null;

    // totalGroupsEstimate: best-effort.
    // - no groupBy → always exactly 1 group
    // - truncated → null (would need a separate count query; expensive)
    // - not truncated → exact (we have all rows)
    const totalGroupsEstimate = planned.groupByFields.length === 0
      ? groups.length
      : (truncated ? null : groups.length);

    const compiledSqlHash = createHash('sha256').update(planned.sql).digest('hex').slice(0, 32);
    await this.prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        actorId: user.id,
        actorType: 'user',
        operation: 'object.aggregate',
        objectType: req.objectType,
        queryPlan: req as unknown as object,
        resultCount: groups.length, // groups.length, NOT metric values
        source: 'api',
        effectivePermissionFilter: planned.effectivePermissionFilter ?? undefined,
        compiledSqlHash,
      },
    });

    const response: AggregationResponse = {
      groups,
      truncated,
      nextPageToken,
      totalGroupsEstimate,
    };
    if (planned.warnings.length > 0) response.warnings = planned.warnings;
    return response;
  }

  private async resolveIncludes(
    tenantId: string,
    objectType: string,
    include: string[],
  ): Promise<Array<{ name: string; targetType: string; foreignKey: string }>> {
    if (!include.length) return [];
    const loaded = await this.viewLoader.loadWithTargetType(tenantId, objectType);
    if (!loaded) return [];
    const { view, relationTargets } = loaded;
    const out: Array<{ name: string; targetType: string; foreignKey: string }> = [];
    for (const name of include) {
      const rel = view.relations[name];
      const target = relationTargets[name];
      if (!rel || !target) {
        throw new BadRequestException(`Unknown relationship in include: ${name}`);
      }
      out.push({ name, targetType: target, foreignKey: rel.foreignKey });
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
      const scope = parentScope({ tenantId, objectType: inc.targetType });
      const { sql: scopeSql, params: scopeParams } = emitScope(scope);
      const fkParamIdx = scopeParams.length + 1;
      const idsParamIdx = scopeParams.length + 2;
      const params: unknown[] = [...scopeParams, inc.foreignKey, parentIds];
      const sql =
        `SELECT id, tenant_id AS "tenantId", object_type AS "objectType", ` +
        `external_id AS "externalId", label, properties, relationships, ` +
        `created_at AS "createdAt", updated_at AS "updatedAt" ` +
        scopeSql +
        ` AND (relationships->>$${fkParamIdx}) = ANY($${idsParamIdx}::text[])`;
      const children = await this.prisma.$queryRawUnsafe<RawInstanceRow[]>(sql, ...params);
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
