# Query Engine + Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Object Query Engine that compiles query plans into PostgreSQL JSONB queries with automatic permission filtering, plus a permission module for RBAC at object/field/action level.

**Architecture:** Two new NestJS modules (query, permission). The query module provides both a public REST endpoint (for admin/debug) and an internal endpoint (for Agent Worker). Permission rules are stored in the Role's `permissions` JSONB field and automatically injected into every query. The query engine operates on ObjectInstances using JSONB property filters, with support for pagination, sorting, and full-text search.

**Tech Stack:** NestJS, Prisma, class-validator, @omaha/shared-types, Jest + supertest

---

## Plan Sequence (6 Plans Total)

| Plan | Status |
|------|--------|
| Plan 1: Foundation | Done |
| Plan 2: Ontology & Mapping | Done |
| **Plan 3: Query Engine + Permissions** (this plan) | Current |
| Plan 4: Agent Worker + Skills | Pending |
| Plan 5: Action Engine + Audit | Pending |
| Plan 6: Frontend (Next.js) | Pending |

---

## File Structure

### Shared Types (`packages/shared-types/src/`)
- Create: `query.ts` — QueryPlan, QueryFilter, QueryResult types
- Create: `permission.ts` — Permission rule types
- Modify: `index.ts` — re-export new modules

### Query Module (`apps/core-api/src/modules/query/`)
- Create: `query.module.ts`
- Create: `query.controller.ts` — Public query endpoint
- Create: `query.service.ts` — Query compilation and execution
- Create: `dto/query-objects.dto.ts`
- Create: `query.service.spec.ts`

### Permission Module (`apps/core-api/src/modules/permission/`)
- Create: `permission.module.ts`
- Create: `permission.service.ts` — Permission checking and filter injection
- Create: `permission.service.spec.ts`

### Seed & E2E
- Modify: `apps/core-api/src/app.module.ts` — import new modules
- Create: `apps/core-api/test/query.e2e-spec.ts`

---

## Task 1: Shared Types for Query and Permission

**Files:**
- Create: `packages/shared-types/src/query.ts`
- Create: `packages/shared-types/src/permission.ts`
- Modify: `packages/shared-types/src/index.ts`

- [ ] **Step 1: Create query types**

Create `packages/shared-types/src/query.ts`:

```typescript
export type FilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in';

export interface QueryFilter {
  field: string;
  operator: FilterOperator;
  value: unknown;
}

export interface QuerySort {
  field: string;
  direction: 'asc' | 'desc';
}

export interface QueryObjectsRequest {
  objectType: string;
  filters?: QueryFilter[];
  search?: string;
  sort?: QuerySort;
  page?: number;
  pageSize?: number;
  select?: string[];
}

export interface QueryObjectsResponse {
  data: ObjectInstanceResult[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    objectType: string;
  };
}

export interface ObjectInstanceResult {
  id: string;
  objectType: string;
  externalId: string;
  label: string | null;
  properties: Record<string, unknown>;
  relationships: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Create permission types**

Create `packages/shared-types/src/permission.ts`:

```typescript
export interface PermissionRule {
  resource: string;
  action: string;
  fields?: string[];
  conditions?: Record<string, unknown>;
}

export function parsePermissions(raw: string[]): PermissionRule[] {
  return raw.map((p) => {
    const parts = p.split('.');
    if (p === '*') return { resource: '*', action: '*' };
    return {
      resource: parts[0],
      action: parts[1] ?? '*',
    };
  });
}

export function hasPermission(
  permissions: string[],
  resource: string,
  action: string,
): boolean {
  return permissions.some((p) => {
    if (p === '*') return true;
    const [res, act] = p.split('.');
    if (res === resource && (act === '*' || act === action)) return true;
    return false;
  });
}
```

- [ ] **Step 3: Update index.ts**

Modify `packages/shared-types/src/index.ts`:

```typescript
export * from './auth';
export * from './common';
export * from './ontology';
export * from './connector';
export * from './mapping';
export * from './query';
export * from './permission';
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/wangfushuaiqi/omaha_ontocenter_v4 && pnpm --filter @omaha/shared-types build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types/src/query.ts packages/shared-types/src/permission.ts packages/shared-types/src/index.ts
git commit -m "feat: add shared types for query engine and permissions"
```

---

## Task 2: Permission Service — Unit Tests and Implementation

**Files:**
- Create: `apps/core-api/src/modules/permission/permission.service.ts`
- Create: `apps/core-api/src/modules/permission/permission.service.spec.ts`
- Create: `apps/core-api/src/modules/permission/permission.module.ts`

- [ ] **Step 1: Write failing tests for PermissionService**

Create `apps/core-api/src/modules/permission/permission.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { PermissionService } from './permission.service';
import { ForbiddenException } from '@nestjs/common';

describe('PermissionService', () => {
  let service: PermissionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PermissionService],
    }).compile();
    service = module.get<PermissionService>(PermissionService);
  });

  describe('canAccess', () => {
    it('should allow wildcard permission', () => {
      expect(service.canAccess(['*'], 'object', 'read')).toBe(true);
    });

    it('should allow exact match', () => {
      expect(service.canAccess(['object.read'], 'object', 'read')).toBe(true);
    });

    it('should allow resource wildcard', () => {
      expect(service.canAccess(['object.*'], 'object', 'read')).toBe(true);
    });

    it('should deny when no matching permission', () => {
      expect(service.canAccess(['object.read'], 'object', 'write')).toBe(false);
    });

    it('should deny empty permissions', () => {
      expect(service.canAccess([], 'object', 'read')).toBe(false);
    });
  });

  describe('assertCanAccess', () => {
    it('should not throw when permitted', () => {
      expect(() => service.assertCanAccess(['*'], 'object', 'read')).not.toThrow();
    });

    it('should throw ForbiddenException when denied', () => {
      expect(() => service.assertCanAccess([], 'object', 'read')).toThrow(ForbiddenException);
    });
  });

  describe('filterFields', () => {
    it('should return all properties when user has wildcard', () => {
      const props = { name: 'Test', phone: '123', secret: 'hidden' };
      const result = service.filterFields(props, ['*']);
      expect(result).toEqual(props);
    });

    it('should return all properties when no field restrictions', () => {
      const props = { name: 'Test', phone: '123' };
      const result = service.filterFields(props, ['object.read']);
      expect(result).toEqual(props);
    });

    it('should filter fields when restrictions exist', () => {
      const props = { name: 'Test', phone: '123', secret: 'hidden' };
      const result = service.filterFields(props, ['object.read:name,phone']);
      expect(result).toEqual({ name: 'Test', phone: '123' });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/wangfushuaiqi/omaha_ontocenter_v4 && pnpm --filter core-api test -- --testPathPattern=permission.service.spec`
Expected: FAIL — cannot find module `./permission.service`

- [ ] **Step 3: Implement PermissionService**

Create `apps/core-api/src/modules/permission/permission.service.ts`:

```typescript
import { Injectable, ForbiddenException } from '@nestjs/common';

@Injectable()
export class PermissionService {
  canAccess(permissions: string[], resource: string, action: string): boolean {
    return permissions.some((p) => {
      if (p === '*') return true;
      const base = p.split(':')[0];
      const [res, act] = base.split('.');
      if (res === resource && (act === '*' || act === action)) return true;
      return false;
    });
  }

  assertCanAccess(permissions: string[], resource: string, action: string): void {
    if (!this.canAccess(permissions, resource, action)) {
      throw new ForbiddenException(`No permission for ${resource}.${action}`);
    }
  }

  filterFields(
    properties: Record<string, unknown>,
    permissions: string[],
  ): Record<string, unknown> {
    if (permissions.includes('*')) return properties;

    const allowedFields = this.extractAllowedFields(permissions);
    if (!allowedFields) return properties;

    const filtered: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (field in properties) filtered[field] = properties[field];
    }
    return filtered;
  }

  private extractAllowedFields(permissions: string[]): string[] | null {
    for (const p of permissions) {
      const colonIdx = p.indexOf(':');
      if (colonIdx !== -1) {
        return p.substring(colonIdx + 1).split(',');
      }
    }
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/wangfushuaiqi/omaha_ontocenter_v4 && pnpm --filter core-api test -- --testPathPattern=permission.service.spec`
Expected: All 8 tests PASS.

- [ ] **Step 5: Create PermissionModule**

Create `apps/core-api/src/modules/permission/permission.module.ts`:

```typescript
import { Global, Module } from '@nestjs/common';
import { PermissionService } from './permission.service';

@Global()
@Module({
  providers: [PermissionService],
  exports: [PermissionService],
})
export class PermissionModule {}
```

- [ ] **Step 6: Register in AppModule**

Modify `apps/core-api/src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from './common/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { OntologyModule } from './modules/ontology/ontology.module';
import { ConnectorModule } from './modules/connector/connector.module';
import { MappingModule } from './modules/mapping/mapping.module';
import { PermissionModule } from './modules/permission/permission.module';

@Module({
  imports: [PrismaModule, AuthModule, TenantModule, OntologyModule, ConnectorModule, MappingModule, PermissionModule],
})
export class AppModule {}
```

- [ ] **Step 7: Commit**

```bash
git add apps/core-api/src/modules/permission/ apps/core-api/src/app.module.ts
git commit -m "feat: add permission module with RBAC service"
```

---

## Task 3: Query Service — Unit Tests and Implementation

**Files:**
- Create: `apps/core-api/src/modules/query/query.service.ts`
- Create: `apps/core-api/src/modules/query/query.service.spec.ts`

- [ ] **Step 1: Write failing tests for QueryService**

Create `apps/core-api/src/modules/query/query.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { QueryService } from './query.service';
import { PrismaService } from '@omaha/db';
import { PermissionService } from '../permission/permission.service';
import { ForbiddenException } from '@nestjs/common';

describe('QueryService', () => {
  let service: QueryService;
  let prisma: {
    objectInstance: {
      findMany: jest.Mock;
      count: jest.Mock;
    };
  };
  let permissionService: {
    canAccess: jest.Mock;
    assertCanAccess: jest.Mock;
    filterFields: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      objectInstance: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };
    permissionService = {
      canAccess: jest.fn().mockReturnValue(true),
      assertCanAccess: jest.fn(),
      filterFields: jest.fn().mockImplementation((props) => props),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueryService,
        { provide: PrismaService, useValue: prisma },
        { provide: PermissionService, useValue: permissionService },
      ],
    }).compile();
    service = module.get<QueryService>(QueryService);
  });

  describe('queryObjects', () => {
    it('should return paginated results for a given object type', async () => {
      const instances = [
        { id: 'i1', objectType: 'customer', externalId: 'C001', label: 'Test', properties: { name: 'Test' }, relationships: {}, createdAt: new Date(), updatedAt: new Date() },
      ];
      prisma.objectInstance.findMany.mockResolvedValue(instances);
      prisma.objectInstance.count.mockResolvedValue(1);

      const result = await service.queryObjects('t1', ['*'], {
        objectType: 'customer',
      });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.objectType).toBe('customer');
      expect(prisma.objectInstance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 't1',
            objectType: 'customer',
          }),
        }),
      );
    });

    it('should apply property filters using JSONB path', async () => {
      prisma.objectInstance.findMany.mockResolvedValue([]);
      prisma.objectInstance.count.mockResolvedValue(0);

      await service.queryObjects('t1', ['*'], {
        objectType: 'customer',
        filters: [{ field: 'region', operator: 'eq', value: '华东' }],
      });

      expect(prisma.objectInstance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              { properties: { path: ['region'], equals: '华东' } },
            ]),
          }),
        }),
      );
    });

    it('should apply search filter on searchText', async () => {
      prisma.objectInstance.findMany.mockResolvedValue([]);
      prisma.objectInstance.count.mockResolvedValue(0);

      await service.queryObjects('t1', ['*'], {
        objectType: 'customer',
        search: '张三',
      });

      expect(prisma.objectInstance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            searchText: { contains: '张三', mode: 'insensitive' },
          }),
        }),
      );
    });

    it('should apply pagination defaults', async () => {
      prisma.objectInstance.findMany.mockResolvedValue([]);
      prisma.objectInstance.count.mockResolvedValue(0);

      const result = await service.queryObjects('t1', ['*'], {
        objectType: 'customer',
      });

      expect(result.meta.page).toBe(1);
      expect(result.meta.pageSize).toBe(20);
      expect(prisma.objectInstance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
        }),
      );
    });

    it('should throw ForbiddenException when user lacks object.read permission', async () => {
      permissionService.assertCanAccess.mockImplementation(() => {
        throw new ForbiddenException();
      });

      await expect(
        service.queryObjects('t1', [], { objectType: 'customer' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should filter fields based on permissions', async () => {
      const instances = [
        { id: 'i1', objectType: 'customer', externalId: 'C001', label: 'Test', properties: { name: 'Test', secret: 'hidden' }, relationships: {}, createdAt: new Date(), updatedAt: new Date() },
      ];
      prisma.objectInstance.findMany.mockResolvedValue(instances);
      prisma.objectInstance.count.mockResolvedValue(1);
      permissionService.filterFields.mockReturnValue({ name: 'Test' });

      const result = await service.queryObjects('t1', ['object.read:name'], {
        objectType: 'customer',
      });

      expect(result.data[0].properties).toEqual({ name: 'Test' });
      expect(permissionService.filterFields).toHaveBeenCalled();
    });

    it('should support sorting by property', async () => {
      prisma.objectInstance.findMany.mockResolvedValue([]);
      prisma.objectInstance.count.mockResolvedValue(0);

      await service.queryObjects('t1', ['*'], {
        objectType: 'customer',
        sort: { field: 'createdAt', direction: 'desc' },
      });

      expect(prisma.objectInstance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        }),
      );
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/wangfushuaiqi/omaha_ontocenter_v4 && pnpm --filter core-api test -- --testPathPattern=query.service.spec`
Expected: FAIL — cannot find module `./query.service`

- [ ] **Step 3: Implement QueryService**

Create `apps/core-api/src/modules/query/query.service.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/wangfushuaiqi/omaha_ontocenter_v4 && pnpm --filter core-api test -- --testPathPattern=query.service.spec`
Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/core-api/src/modules/query/query.service.ts apps/core-api/src/modules/query/query.service.spec.ts
git commit -m "feat: add QueryService with JSONB filter compilation and permission integration"
```

---

## Task 4: Query DTO, Controller, and Module

**Files:**
- Create: `apps/core-api/src/modules/query/dto/query-objects.dto.ts`
- Create: `apps/core-api/src/modules/query/query.controller.ts`
- Create: `apps/core-api/src/modules/query/query.module.ts`
- Modify: `apps/core-api/src/app.module.ts`

- [ ] **Step 1: Create DTO**

Create `apps/core-api/src/modules/query/dto/query-objects.dto.ts`:

```typescript
import { IsString, IsOptional, IsArray, IsInt, Min, Max, ValidateNested, IsIn, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

class QueryFilterDto {
  @IsString()
  field!: string;

  @IsIn(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in'])
  operator!: string;

  value!: unknown;
}

class QuerySortDto {
  @IsString()
  field!: string;

  @IsIn(['asc', 'desc'])
  direction!: 'asc' | 'desc';
}

export class QueryObjectsDto {
  @IsString()
  @MinLength(1)
  objectType!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QueryFilterDto)
  filters?: QueryFilterDto[];

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => QuerySortDto)
  sort?: QuerySortDto;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  select?: string[];
}
```

- [ ] **Step 2: Create QueryController**

Create `apps/core-api/src/modules/query/query.controller.ts`:

```typescript
import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { QueryService } from './query.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { QueryObjectsDto } from './dto/query-objects.dto';
import { CurrentUser as CurrentUserType } from '@omaha/shared-types';

@Controller('query')
@UseGuards(JwtAuthGuard)
export class QueryController {
  constructor(private readonly queryService: QueryService) {}

  @Post('objects')
  queryObjects(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: QueryObjectsDto,
  ): Promise<unknown> {
    return this.queryService.queryObjects(user.tenantId, user.permissions, dto);
  }
}
```

- [ ] **Step 3: Create QueryModule and register in AppModule**

Create `apps/core-api/src/modules/query/query.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { QueryController } from './query.controller';
import { QueryService } from './query.service';

@Module({
  controllers: [QueryController],
  providers: [QueryService],
  exports: [QueryService],
})
export class QueryModule {}
```

Modify `apps/core-api/src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from './common/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { OntologyModule } from './modules/ontology/ontology.module';
import { ConnectorModule } from './modules/connector/connector.module';
import { MappingModule } from './modules/mapping/mapping.module';
import { PermissionModule } from './modules/permission/permission.module';
import { QueryModule } from './modules/query/query.module';

@Module({
  imports: [PrismaModule, AuthModule, TenantModule, OntologyModule, ConnectorModule, MappingModule, PermissionModule, QueryModule],
})
export class AppModule {}
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/wangfushuaiqi/omaha_ontocenter_v4 && pnpm --filter core-api build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/core-api/src/modules/query/ apps/core-api/src/app.module.ts
git commit -m "feat: add query module with controller and DTO"
```

---

## Task 5: E2E Tests for Query Engine

**Files:**
- Create: `apps/core-api/test/query.e2e-spec.ts`

- [ ] **Step 1: Create query E2E tests**

Create `apps/core-api/test/query.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, loginAsAdmin } from './test-helpers';

describe('Query (e2e)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await loginAsAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /query/objects — should return customers', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({ objectType: 'customer' })
      .expect(201);

    expect(res.body.data).toBeDefined();
    expect(res.body.data.length).toBeGreaterThanOrEqual(3);
    expect(res.body.meta.objectType).toBe('customer');
    expect(res.body.meta.total).toBeGreaterThanOrEqual(3);
    expect(res.body.data[0].properties.name).toBeDefined();
  });

  it('POST /query/objects — should filter by property', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'customer',
        filters: [{ field: 'region', operator: 'eq', value: '华东' }],
      })
      .expect(201);

    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    for (const item of res.body.data) {
      expect(item.properties.region).toBe('华东');
    }
  });

  it('POST /query/objects — should search by text', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'customer',
        search: '张三',
      })
      .expect(201);

    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('POST /query/objects — should paginate results', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'customer',
        page: 1,
        pageSize: 2,
      })
      .expect(201);

    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.pageSize).toBe(2);
    expect(res.body.meta.totalPages).toBeGreaterThanOrEqual(1);
  });

  it('POST /query/objects — should query orders', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({ objectType: 'order' })
      .expect(201);

    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    expect(res.body.data[0].properties.orderNo).toBeDefined();
  });

  it('POST /query/objects — should return empty for unknown type', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({ objectType: 'nonexistent' })
      .expect(201);

    expect(res.body.data).toEqual([]);
    expect(res.body.meta.total).toBe(0);
  });

  it('POST /query/objects — should return 401 without token', () => {
    return request(app.getHttpServer())
      .post('/query/objects')
      .send({ objectType: 'customer' })
      .expect(401);
  });

  it('POST /query/objects — should return 400 without objectType', () => {
    return request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);
  });
});
```

- [ ] **Step 2: Run all E2E tests**

Run: `cd /Users/wangfushuaiqi/omaha_ontocenter_v4 && pnpm --filter core-api test:e2e`
Expected: All E2E tests pass (auth + ontology + connector + mapping + query).

- [ ] **Step 3: Run all unit tests to verify no regressions**

Run: `cd /Users/wangfushuaiqi/omaha_ontocenter_v4 && pnpm --filter core-api test`
Expected: All unit tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/core-api/test/query.e2e-spec.ts
git commit -m "test: add E2E tests for query engine with filters, search, and pagination"
```

---

## Task 6: Permission-Restricted Query Test (Operator Role)

**Files:**
- Modify: `apps/core-api/test/query.e2e-spec.ts`

- [ ] **Step 1: Add operator login helper to test-helpers**

Modify `apps/core-api/test/test-helpers.ts` — add:

```typescript
export async function loginAsOperator(app: INestApplication): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email: 'ops@demo.com', password: 'admin123', tenantSlug: 'demo' });
  return res.body.accessToken;
}
```

- [ ] **Step 2: Add operator permission tests to query E2E**

Add to `apps/core-api/test/query.e2e-spec.ts` inside the describe block, after existing tests:

```typescript
  describe('Operator role', () => {
    let opsToken: string;

    beforeAll(async () => {
      opsToken = await loginAsOperator(app);
    });

    it('POST /query/objects — operator should be able to query objects', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/objects')
        .set('Authorization', `Bearer ${opsToken}`)
        .send({ objectType: 'customer' })
        .expect(201);

      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });
```

- [ ] **Step 3: Update test-helpers import in query E2E**

Update the import in `apps/core-api/test/query.e2e-spec.ts`:

```typescript
import { createTestApp, loginAsAdmin, loginAsOperator } from './test-helpers';
```

- [ ] **Step 4: Run E2E tests**

Run: `cd /Users/wangfushuaiqi/omaha_ontocenter_v4 && pnpm --filter core-api test:e2e`
Expected: All E2E tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/core-api/test/query.e2e-spec.ts apps/core-api/test/test-helpers.ts
git commit -m "test: add operator role permission test for query engine"
```
