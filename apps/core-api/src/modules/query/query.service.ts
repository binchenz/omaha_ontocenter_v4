import { Injectable } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { PermissionService } from '../permission/permission.service';
import { QueryObjectsRequest, QueryObjectsResponse, FilterOperator } from '@omaha/shared-types';

@Injectable()
export class QueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionService: PermissionService,
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

    const where = this.buildWhere(tenantId, req);
    const orderBy = this.buildOrderBy(req);

    const [instances, total] = await Promise.all([
      this.prisma.objectInstance.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
      }),
      this.prisma.objectInstance.count({ where }),
    ]);

    const data = instances.map((inst) => ({
      id: inst.id,
      objectType: inst.objectType,
      externalId: inst.externalId,
      label: inst.label,
      properties: this.permissionService.filterFields(
        inst.properties as Record<string, unknown>,
        permissions,
      ),
      relationships: inst.relationships as Record<string, unknown>,
      createdAt: inst.createdAt.toISOString(),
      updatedAt: inst.updatedAt.toISOString(),
    }));

    return {
      data,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
        objectType: req.objectType,
      },
    };
  }

  private buildWhere(tenantId: string, req: QueryObjectsRequest) {
    const where: Record<string, unknown> = {
      tenantId,
      objectType: req.objectType,
    };

    if (req.search) {
      where.searchText = { contains: req.search, mode: 'insensitive' };
    }

    if (req.filters && req.filters.length > 0) {
      where.AND = req.filters.map((f) => ({
        properties: this.buildJsonFilter(f.field, f.operator, f.value),
      }));
    }

    return where;
  }

  private buildJsonFilter(field: string, operator: FilterOperator, value: unknown) {
    switch (operator) {
      case 'eq':
        return { path: [field], equals: value };
      case 'neq':
        return { path: [field], not: value };
      case 'gt':
        return { path: [field], gt: value };
      case 'gte':
        return { path: [field], gte: value };
      case 'lt':
        return { path: [field], lt: value };
      case 'lte':
        return { path: [field], lte: value };
      case 'contains':
        return { path: [field], string_contains: value };
      case 'in':
        return { path: [field], array_contains: value };
      default:
        return { path: [field], equals: value };
    }
  }

  private buildOrderBy(req: QueryObjectsRequest) {
    if (!req.sort) return { createdAt: 'desc' as const };
    const { field, direction } = req.sort;
    if (['createdAt', 'updatedAt', 'externalId', 'label'].includes(field)) {
      return { [field]: direction };
    }
    return { createdAt: direction };
  }
}
