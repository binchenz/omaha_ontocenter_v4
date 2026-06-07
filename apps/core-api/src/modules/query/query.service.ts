import { Injectable, BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '@omaha/db';
import { parentScope } from '@omaha/dsl';
import { ScopedWhere } from './scoped-where';
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
import { ProvenanceGate } from './provenance-gate.service';
import { toInstanceDto } from '../../common/to-instance-dto';
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
    private readonly provenanceGate: ProvenanceGate,
  ) {}

  private get queryTimeoutMs(): number {
    return parseInt(process.env.QUERY_TIMEOUT_MS ?? '5000', 10);
  }

  /**
   * Execute a raw SQL query inside a transaction with SET LOCAL statement_timeout.
   * If PostgreSQL cancels the query (error code 57014), throws a structured BadRequestException.
   */
  private async executeWithTimeout<T>(sql: string, params: unknown[]): Promise<T> {
    try {
      const timeoutMs = this.queryTimeoutMs;
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${timeoutMs}ms'`);
        return tx.$queryRawUnsafe<T>(sql, ...params);
      });
      return result;
    } catch (err: unknown) {
      if (this.isQueryCanceled(err)) {
        throw new BadRequestException({
          error: {
            code: 'QUERY_TIMEOUT',
            message: `Query exceeded the ${this.queryTimeoutMs}ms timeout and was canceled.`,
            hint: 'Simplify filters, reduce result set, or ask your administrator to increase QUERY_TIMEOUT_MS.',
          },
        });
      }
      throw err;
    }
  }

  private isQueryCanceled(err: unknown): boolean {
    if (err && typeof err === 'object') {
      // Prisma wraps PG errors; the code may be on the error itself or nested.
      const code = (err as Record<string, unknown>).code
        ?? ((err as Record<string, unknown>).meta as Record<string, unknown> | undefined)?.code;
      if (code === '57014') return true;
      // Also check the error message for the cancellation signal.
      const message = String((err as Record<string, unknown>).message ?? '');
      if (message.includes('canceling statement due to statement timeout')) return true;
    }
    return false;
  }

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

    const verdict = await this.provenanceGate.evaluate(user.tenantId, req.objectType, req.filters);
    if (verdict.error) this.throwProvenanceError(req.objectType, verdict.error);

    const planned = await this.planner.plan({
      tenantId: user.tenantId,
      objectType: req.objectType,
      filters: req.filters,
      search: req.search,
      sort: req.sort,
      skip,
      take: pageSize,
      permissionPredicates: resolution.predicates,
      allowedFields: resolution.allowedFields,
    });

    const [rows, countRows] = await Promise.all([
      this.executeWithTimeout<RawInstanceRow[]>(planned.sql, planned.params),
      this.executeWithTimeout<{ count: number }[]>(planned.countSql, planned.params),
    ]);
    const total = Number(countRows[0]?.count ?? 0);

    const includes = await this.resolveIncludes(user.tenantId, req.objectType, req.include ?? []);
    const includedByParent = await this.fetchIncludes(user, rows.map((r) => r.externalId), includes);

    const data = rows.map((inst) => {
      // toInstanceDto seals the mask-before-select ordering: visibility first,
      // then the caller's select narrows what survived. select cannot unmask.
      const projected = toInstanceDto(
        inst.properties as Record<string, unknown> | null,
        resolution.allowedFields,
        req.select,
      );

      const relationships: Record<string, unknown> = {};
      for (const inc of includes) {
        relationships[inc.name] = includedByParent[inst.externalId]?.[inc.name] ?? [];
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
        ...(verdict.warnings.length > 0 && { warnings: verdict.warnings }),
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

    // Coverage Gate (ADR-0044): same pre-flight as queryObjects — aggregating a
    // model-layer star over an essence period must warn, not silently return 0.
    const verdict = await this.provenanceGate.evaluate(user.tenantId, req.objectType, req.filters);
    if (verdict.error) this.throwProvenanceError(req.objectType, verdict.error);

    // Cross-relationship groupBy ("relation.field") groups by a field on a
    // RELATED type; that field must be gated by the related type's own
    // visibility. Resolve the other type's read permission so the planner can
    // narrow its view too. Denial ⇒ the relation is unreadable; reject the
    // whole aggregate rather than leak grouped keys from it.
    let crossRelAllowedFields: Set<string> | null | undefined;
    const crossKey = (req.groupBy ?? []).find((g) => typeof g === 'string' && g.includes('.'));
    if (crossKey) {
      const relationName = crossKey.slice(0, crossKey.indexOf('.'));
      const resolved = await this.viewLoader.resolveRelationByName(user.tenantId, req.objectType, relationName);
      if (resolved) {
        const otherRes = await this.permissionResolver.resolveOrThrow(user, 'object', 'read', resolved.otherType);
        crossRelAllowedFields = otherRes.allowedFields;
      }
    }

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
      allowedFields: resolution.allowedFields,
      crossRelAllowedFields,
    });

    const rows = await this.executeWithTimeout<Record<string, unknown>[]>(planned.sql, planned.params);

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
    if (planned.warnings.length > 0 || verdict.warnings.length > 0) {
      response.warnings = [...planned.warnings, ...verdict.warnings];
    }
    return response;
  }

  private async resolveIncludes(
    tenantId: string,
    objectType: string,
    include: string[],
  ): Promise<Array<{ name: string; targetType: string; storageKey: string }>> {
    if (!include.length) return [];
    const view = await this.viewLoader.load(tenantId, objectType);
    if (!view) return [];
    const out: Array<{ name: string; targetType: string; storageKey: string }> = [];
    for (const name of include) {
      const rel = view.relations[name];
      if (!rel) {
        throw new BadRequestException(`Unknown relationship in include: ${name}`);
      }
      // v1 include fetches the many-side children of a to-one parent. The
      // relation runs source(one) --> target(many); the many side holds the FK,
      // storing the parent's external_id under the relation name. Including from
      // the source/one side means currentType==source → fkSide='other' (the
      // other/child side holds the key). The reverse (fkSide='self': this row is
      // the many side pointing at its one parent) is a to-one lookup — a
      // different shape — so reject rather than emit wrong rows.
      if (rel.fkSide !== 'other') {
        throw new BadRequestException({
          code: 'INCLUDE_DIRECTION_UNSUPPORTED',
          relation: name,
          hint: `include '${name}' from '${objectType}' is only supported toward the child (many) side in v1.`,
        });
      }
      out.push({ name, targetType: rel.otherType, storageKey: rel.storageKey });
    }
    return out;
  }

  private async fetchIncludes(
    user: CurrentUserType,
    parentExternalIds: string[],
    includes: Array<{ name: string; targetType: string; storageKey: string }>,
  ): Promise<Record<string, Record<string, unknown[]>>> {
    if (!parentExternalIds.length || !includes.length) return {};
    const out: Record<string, Record<string, unknown[]>> = {};
    for (const id of parentExternalIds) out[id] = {};

    for (const inc of includes) {
      // Resolve the CHILD type's permission: yields both the row-level
      // predicates and the field mask. Denial ⇒ omit the relation entirely
      // (it surfaces as an empty array via the caller's `?? []`).
      const childRes = await this.permissionResolver.resolve(user, 'object', 'read', inc.targetType);
      if (!childRes.allowed) continue;

      const scope = parentScope({ tenantId: user.tenantId, objectType: inc.targetType });
      const scoped = new ScopedWhere(scope, { keepFrom: true })
        .raw('(relationships->>?) = ANY(?::text[])', inc.storageKey, parentExternalIds)
        .predicates(childRes.predicates);
      const { fromWhere, params } = scoped.build();
      const sql =
        `SELECT id, tenant_id AS "tenantId", object_type AS "objectType", ` +
        `external_id AS "externalId", label, properties, relationships, ` +
        `created_at AS "createdAt", updated_at AS "updatedAt" ` +
        fromWhere;
      const children = await this.prisma.$queryRawUnsafe<RawInstanceRow[]>(sql, ...params);
      for (const c of children) {
        // Canonical convention: child stores { <storageKey>: <parent externalId> }.
        const parentKey = (c.relationships as Record<string, unknown> | null)?.[inc.storageKey] as string | undefined;
        if (!parentKey) continue;
        const bucket = out[parentKey];
        if (!bucket) continue;
        if (!bucket[inc.name]) bucket[inc.name] = [];
        bucket[inc.name].push({
          id: c.id,
          objectType: c.objectType,
          externalId: c.externalId,
          label: c.label,
          properties: toInstanceDto(
            c.properties as Record<string, unknown> | null,
            childRes.allowedFields,
          ),
        });
      }
    }
    return out;
  }

  /** Throw a structured BadRequestException when the Coverage Gate reports an error. */
  private throwProvenanceError(objectType: string, code: string): never {
    throw new BadRequestException({
      error: { code, message: `No AVC report covers the requested scope for '${objectType}'.`, hint: 'This (品类, 周期) was never ingested — distinct from a real zero. Ingest the report or widen the period.' },
    });
  }
}
