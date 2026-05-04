import { Injectable } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { PermissionService } from '../permission/permission.service';
import { QueryObjectsRequest, QueryObjectsResponse } from '@omaha/shared-types';
import { QueryPlannerService } from './query-planner.service';

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
    private readonly permissionService: PermissionService,
    private readonly planner: QueryPlannerService,
  ) {}

  async queryObjects(
    tenantId: string,
    permissions: string[],
    req: QueryObjectsRequest,
  ): Promise<QueryObjectsResponse> {
    this.permissionService.assertCanAccess(permissions, 'object', 'read');

    const page = req.page ?? 1;
    const pageSize = Math.min(req.pageSize ?? 20, 100);
    const skip = (page - 1) * pageSize;

    const planned = await this.planner.plan({
      tenantId,
      objectType: req.objectType,
      filters: req.filters,
      search: req.search,
      sort: req.sort,
      skip,
      take: pageSize,
    });

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<RawInstanceRow[]>(planned.sql, ...planned.params),
      this.prisma.$queryRawUnsafe<{ count: number }[]>(planned.countSql, ...planned.params),
    ]);
    const total = Number(countRows[0]?.count ?? 0);

    const allowedFields = this.permissionService.getAllowedFields(permissions, 'object', 'read');

    const data = rows.map((inst) => ({
      id: inst.id,
      objectType: inst.objectType,
      externalId: inst.externalId,
      label: inst.label,
      properties: this.permissionService.filterFields(
        (inst.properties ?? {}) as Record<string, unknown>,
        allowedFields,
      ),
      relationships: (inst.relationships ?? {}) as Record<string, unknown>,
      createdAt: inst.createdAt.toISOString(),
      updatedAt: inst.updatedAt.toISOString(),
    }));

    return {
      data,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize) || 0,
        objectType: req.objectType,
      },
    };
  }
}
