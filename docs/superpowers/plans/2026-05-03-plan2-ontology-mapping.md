# Ontology & Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build CRUD modules for ObjectType, ObjectRelationship, Connector, and ObjectMapping — the ontology backbone that the Agent will query at runtime.

**Architecture:** Four NestJS modules (ontology, connector, mapping) behind JWT auth, all using the global PrismaModule. Shared DTOs and response types in `@omaha/shared-types`. Seed script extended with demo ontology data (customers, orders, products) and sample ObjectInstances.

**Tech Stack:** NestJS, Prisma, class-validator, @omaha/shared-types, Jest + supertest

---

## File Structure

### Shared Types (`packages/shared-types/src/`)
- Create: `ontology.ts` — ObjectType/ObjectRelationship DTOs and response types
- Create: `connector.ts` — Connector DTOs and response types
- Create: `mapping.ts` — ObjectMapping DTOs and response types
- Modify: `index.ts` — re-export new modules

### Ontology Module (`apps/core-api/src/modules/ontology/`)
- Create: `ontology.module.ts`
- Create: `ontology.controller.ts` — ObjectType + ObjectRelationship endpoints
- Create: `ontology.service.ts`
- Create: `dto/create-object-type.dto.ts`
- Create: `dto/update-object-type.dto.ts`
- Create: `dto/create-relationship.dto.ts`
- Create: `ontology.service.spec.ts`

### Connector Module (`apps/core-api/src/modules/connector/`)
- Create: `connector.module.ts`
- Create: `connector.controller.ts`
- Create: `connector.service.ts`
- Create: `dto/create-connector.dto.ts`
- Create: `dto/update-connector.dto.ts`
- Create: `connector.service.spec.ts`

### Mapping Module (`apps/core-api/src/modules/mapping/`)
- Create: `mapping.module.ts`
- Create: `mapping.controller.ts`
- Create: `mapping.service.ts`
- Create: `dto/create-mapping.dto.ts`
- Create: `mapping.service.spec.ts`

### Seed & E2E
- Modify: `packages/db/seed.ts` — add ontology + instance data
- Modify: `apps/core-api/src/app.module.ts` — import new modules
- Create: `apps/core-api/test/ontology.e2e-spec.ts`
- Create: `apps/core-api/test/connector.e2e-spec.ts`
- Create: `apps/core-api/test/mapping.e2e-spec.ts`

---

## Task 1: Shared Types for Ontology, Connector, and Mapping

**Files:**
- Create: `packages/shared-types/src/ontology.ts`
- Create: `packages/shared-types/src/connector.ts`
- Create: `packages/shared-types/src/mapping.ts`
- Modify: `packages/shared-types/src/index.ts`

- [ ] **Step 1: Create ontology types**

Create `packages/shared-types/src/ontology.ts`:

```typescript
export interface PropertyDefinition {
  name: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'json';
  required?: boolean;
}

export interface CreateObjectTypeRequest {
  name: string;
  label: string;
  properties: PropertyDefinition[];
  derivedProperties?: PropertyDefinition[];
}

export interface UpdateObjectTypeRequest {
  label?: string;
  properties?: PropertyDefinition[];
  derivedProperties?: PropertyDefinition[];
}

export interface ObjectTypeResponse {
  id: string;
  tenantId: string;
  name: string;
  label: string;
  properties: PropertyDefinition[];
  derivedProperties: PropertyDefinition[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type Cardinality = 'one-to-one' | 'one-to-many' | 'many-to-many';

export interface CreateRelationshipRequest {
  sourceTypeId: string;
  targetTypeId: string;
  name: string;
  cardinality: Cardinality;
}

export interface RelationshipResponse {
  id: string;
  tenantId: string;
  sourceTypeId: string;
  targetTypeId: string;
  name: string;
  cardinality: string;
  createdAt: string;
}
```

- [ ] **Step 2: Create connector types**

Create `packages/shared-types/src/connector.ts`:

```typescript
export interface CreateConnectorRequest {
  name: string;
  type: string;
  config: Record<string, unknown>;
}

export interface UpdateConnectorRequest {
  name?: string;
  config?: Record<string, unknown>;
  status?: string;
}

export interface ConnectorResponse {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  status: string;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 3: Create mapping types**

Create `packages/shared-types/src/mapping.ts`:

```typescript
export interface PropertyMapping {
  objectProperty: string;
  sourceColumn: string;
  transform?: string;
}

export interface CreateMappingRequest {
  objectTypeId: string;
  connectorId: string;
  tableName: string;
  propertyMappings: Record<string, PropertyMapping>;
  relationshipMappings?: Record<string, unknown>;
}

export interface MappingResponse {
  id: string;
  tenantId: string;
  objectTypeId: string;
  connectorId: string;
  tableName: string;
  propertyMappings: Record<string, PropertyMapping>;
  relationshipMappings: Record<string, unknown>;
  createdAt: string;
}
```

- [ ] **Step 4: Update index.ts**

Modify `packages/shared-types/src/index.ts`:

```typescript
export * from './auth';
export * from './common';
export * from './ontology';
export * from './connector';
export * from './mapping';
```

- [ ] **Step 5: Verify build**

Run: `cd /Users/wangfushuaiqi/omaha_ontocenter_v4 && pnpm --filter @omaha/shared-types build`
Expected: Build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared-types/src/ontology.ts packages/shared-types/src/connector.ts packages/shared-types/src/mapping.ts packages/shared-types/src/index.ts
git commit -m "feat: add shared types for ontology, connector, and mapping"
```

---

## Task 2: Ontology Service — Unit Tests and Implementation

**Files:**
- Create: `apps/core-api/src/modules/ontology/ontology.service.ts`
- Create: `apps/core-api/src/modules/ontology/ontology.service.spec.ts`

- [ ] **Step 1: Write failing tests for OntologyService**

Create `apps/core-api/src/modules/ontology/ontology.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { OntologyService } from './ontology.service';
import { PrismaService } from '@omaha/db';
import { NotFoundException } from '@nestjs/common';

describe('OntologyService', () => {
  let service: OntologyService;
  let prisma: {
    objectType: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    objectRelationship: {
      findMany: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      objectType: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      objectRelationship: {
        findMany: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OntologyService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get<OntologyService>(OntologyService);
  });

  describe('listObjectTypes', () => {
    it('should return all object types for a tenant', async () => {
      const types = [{ id: 'ot1', name: 'customer', label: 'Customer' }];
      prisma.objectType.findMany.mockResolvedValue(types);
      const result = await service.listObjectTypes('t1');
      expect(result).toEqual(types);
      expect(prisma.objectType.findMany).toHaveBeenCalledWith({
        where: { tenantId: 't1' },
        orderBy: { name: 'asc' },
      });
    });
  });

  describe('getObjectType', () => {
    it('should return object type by id', async () => {
      const ot = { id: 'ot1', tenantId: 't1', name: 'customer' };
      prisma.objectType.findUnique.mockResolvedValue(ot);
      const result = await service.getObjectType('t1', 'ot1');
      expect(result).toEqual(ot);
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.objectType.findUnique.mockResolvedValue(null);
      await expect(service.getObjectType('t1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createObjectType', () => {
    it('should create and return object type', async () => {
      const created = { id: 'ot1', tenantId: 't1', name: 'customer', label: 'Customer', properties: [], derivedProperties: [], version: 1 };
      prisma.objectType.create.mockResolvedValue(created);
      const result = await service.createObjectType('t1', { name: 'customer', label: 'Customer', properties: [] });
      expect(result).toEqual(created);
      expect(prisma.objectType.create).toHaveBeenCalledWith({
        data: { tenantId: 't1', name: 'customer', label: 'Customer', properties: [], derivedProperties: [] },
      });
    });
  });

  describe('updateObjectType', () => {
    it('should update and return object type', async () => {
      const existing = { id: 'ot1', tenantId: 't1', version: 1 };
      prisma.objectType.findUnique.mockResolvedValue(existing);
      const updated = { ...existing, label: 'Updated', version: 2 };
      prisma.objectType.update.mockResolvedValue(updated);
      const result = await service.updateObjectType('t1', 'ot1', { label: 'Updated' });
      expect(result).toEqual(updated);
    });
  });

  describe('deleteObjectType', () => {
    it('should delete object type', async () => {
      const existing = { id: 'ot1', tenantId: 't1' };
      prisma.objectType.findUnique.mockResolvedValue(existing);
      prisma.objectType.delete.mockResolvedValue(existing);
      await service.deleteObjectType('t1', 'ot1');
      expect(prisma.objectType.delete).toHaveBeenCalledWith({ where: { id: 'ot1' } });
    });
  });

  describe('listRelationships', () => {
    it('should return relationships for a tenant', async () => {
      const rels = [{ id: 'r1', name: 'has_orders' }];
      prisma.objectRelationship.findMany.mockResolvedValue(rels);
      const result = await service.listRelationships('t1');
      expect(result).toEqual(rels);
    });
  });

  describe('createRelationship', () => {
    it('should create and return relationship', async () => {
      const created = { id: 'r1', tenantId: 't1', sourceTypeId: 'ot1', targetTypeId: 'ot2', name: 'has_orders', cardinality: 'one-to-many' };
      prisma.objectRelationship.create.mockResolvedValue(created);
      const result = await service.createRelationship('t1', { sourceTypeId: 'ot1', targetTypeId: 'ot2', name: 'has_orders', cardinality: 'one-to-many' });
      expect(result).toEqual(created);
    });
  });

  describe('deleteRelationship', () => {
    it('should delete relationship', async () => {
      prisma.objectRelationship.delete.mockResolvedValue({});
      await service.deleteRelationship('t1', 'r1');
      expect(prisma.objectRelationship.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/wangfushuaiqi/omaha_ontocenter_v4 && pnpm --filter core-api test -- --testPathPattern=ontology.service.spec`
Expected: FAIL — cannot find module `./ontology.service`

- [ ] **Step 3: Implement OntologyService**

Create `apps/core-api/src/modules/ontology/ontology.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { CreateObjectTypeRequest, UpdateObjectTypeRequest, CreateRelationshipRequest } from '@omaha/shared-types';

@Injectable()
export class OntologyService {
  constructor(private readonly prisma: PrismaService) {}

  async listObjectTypes(tenantId: string) {
    return this.prisma.objectType.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
  }

  async getObjectType(tenantId: string, id: string) {
    const ot = await this.prisma.objectType.findUnique({
      where: { id },
    });
    if (!ot || ot.tenantId !== tenantId) throw new NotFoundException('ObjectType not found');
    return ot;
  }

  async createObjectType(tenantId: string, dto: CreateObjectTypeRequest) {
    return this.prisma.objectType.create({
      data: {
        tenantId,
        name: dto.name,
        label: dto.label,
        properties: dto.properties,
        derivedProperties: dto.derivedProperties ?? [],
      },
    });
  }

  async updateObjectType(tenantId: string, id: string, dto: UpdateObjectTypeRequest) {
    await this.getObjectType(tenantId, id);
    return this.prisma.objectType.update({
      where: { id },
      data: {
        ...dto.label !== undefined && { label: dto.label },
        ...dto.properties !== undefined && { properties: dto.properties },
        ...dto.derivedProperties !== undefined && { derivedProperties: dto.derivedProperties },
        version: { increment: 1 },
      },
    });
  }

  async deleteObjectType(tenantId: string, id: string) {
    await this.getObjectType(tenantId, id);
    return this.prisma.objectType.delete({ where: { id } });
  }

  async listRelationships(tenantId: string) {
    return this.prisma.objectRelationship.findMany({
      where: { tenantId },
      include: { sourceType: true, targetType: true },
    });
  }

  async createRelationship(tenantId: string, dto: CreateRelationshipRequest) {
    return this.prisma.objectRelationship.create({
      data: {
        tenantId,
        sourceTypeId: dto.sourceTypeId,
        targetTypeId: dto.targetTypeId,
        name: dto.name,
        cardinality: dto.cardinality,
      },
    });
  }

  async deleteRelationship(tenantId: string, id: string) {
    return this.prisma.objectRelationship.delete({ where: { id } });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/wangfushuaiqi/omaha_ontocenter_v4 && pnpm --filter core-api test -- --testPathPattern=ontology.service.spec`
Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/core-api/src/modules/ontology/ontology.service.ts apps/core-api/src/modules/ontology/ontology.service.spec.ts
git commit -m "feat: add OntologyService with unit tests"
```

---

## Task 3: Ontology DTOs, Controller, and Module

**Files:**
- Create: `apps/core-api/src/modules/ontology/dto/create-object-type.dto.ts`
- Create: `apps/core-api/src/modules/ontology/dto/update-object-type.dto.ts`
- Create: `apps/core-api/src/modules/ontology/dto/create-relationship.dto.ts`
- Create: `apps/core-api/src/modules/ontology/ontology.controller.ts`
- Create: `apps/core-api/src/modules/ontology/ontology.module.ts`
- Modify: `apps/core-api/src/app.module.ts`

- [ ] **Step 1: Create DTOs**

Create `apps/core-api/src/modules/ontology/dto/create-object-type.dto.ts`:

```typescript
import { IsString, IsArray, IsOptional, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class PropertyDefinitionDto {
  @IsString()
  name: string;

  @IsString()
  label: string;

  @IsString()
  type: string;

  @IsOptional()
  required?: boolean;
}

export class CreateObjectTypeDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @MinLength(1)
  label: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PropertyDefinitionDto)
  properties: PropertyDefinitionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PropertyDefinitionDto)
  derivedProperties?: PropertyDefinitionDto[];
}
```

Create `apps/core-api/src/modules/ontology/dto/update-object-type.dto.ts`:

```typescript
import { IsString, IsArray, IsOptional, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class PropertyDefinitionDto {
  @IsString()
  name: string;

  @IsString()
  label: string;

  @IsString()
  type: string;

  @IsOptional()
  required?: boolean;
}

export class UpdateObjectTypeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  label?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PropertyDefinitionDto)
  properties?: PropertyDefinitionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PropertyDefinitionDto)
  derivedProperties?: PropertyDefinitionDto[];
}
```

Create `apps/core-api/src/modules/ontology/dto/create-relationship.dto.ts`:

```typescript
import { IsString, IsUUID, IsIn } from 'class-validator';

export class CreateRelationshipDto {
  @IsUUID()
  sourceTypeId: string;

  @IsUUID()
  targetTypeId: string;

  @IsString()
  name: string;

  @IsIn(['one-to-one', 'one-to-many', 'many-to-many'])
  cardinality: string;
}
```

- [ ] **Step 2: Create OntologyController**

Create `apps/core-api/src/modules/ontology/ontology.controller.ts`:

```typescript
import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { OntologyService } from './ontology.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateObjectTypeDto } from './dto/create-object-type.dto';
import { UpdateObjectTypeDto } from './dto/update-object-type.dto';
import { CreateRelationshipDto } from './dto/create-relationship.dto';

@Controller('ontology')
@UseGuards(JwtAuthGuard)
export class OntologyController {
  constructor(private readonly ontologyService: OntologyService) {}

  @Get('types')
  listTypes(@CurrentUser('tenantId') tenantId: string) {
    return this.ontologyService.listObjectTypes(tenantId);
  }

  @Get('types/:id')
  getType(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.ontologyService.getObjectType(tenantId, id);
  }

  @Post('types')
  createType(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateObjectTypeDto) {
    return this.ontologyService.createObjectType(tenantId, dto);
  }

  @Put('types/:id')
  updateType(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string, @Body() dto: UpdateObjectTypeDto) {
    return this.ontologyService.updateObjectType(tenantId, id, dto);
  }

  @Delete('types/:id')
  deleteType(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.ontologyService.deleteObjectType(tenantId, id);
  }

  @Get('relationships')
  listRelationships(@CurrentUser('tenantId') tenantId: string) {
    return this.ontologyService.listRelationships(tenantId);
  }

  @Post('relationships')
  createRelationship(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateRelationshipDto) {
    return this.ontologyService.createRelationship(tenantId, dto);
  }

  @Delete('relationships/:id')
  deleteRelationship(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.ontologyService.deleteRelationship(tenantId, id);
  }
}
```

- [ ] **Step 3: Create OntologyModule**

Create `apps/core-api/src/modules/ontology/ontology.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { OntologyController } from './ontology.controller';
import { OntologyService } from './ontology.service';

@Module({
  controllers: [OntologyController],
  providers: [OntologyService],
  exports: [OntologyService],
})
export class OntologyModule {}
```

- [ ] **Step 4: Register in AppModule**

Modify `apps/core-api/src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from './common/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { OntologyModule } from './modules/ontology/ontology.module';

@Module({
  imports: [PrismaModule, AuthModule, TenantModule, OntologyModule],
})
export class AppModule {}
```

- [ ] **Step 5: Verify build**

Run: `cd /Users/wangfushuaiqi/omaha_ontocenter_v4 && pnpm --filter core-api build`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/core-api/src/modules/ontology/ apps/core-api/src/app.module.ts
git commit -m "feat: add ontology module with controller and DTOs"
```

---

## Task 4: Connector Service — Unit Tests and Implementation

**Files:**
- Create: `apps/core-api/src/modules/connector/connector.service.ts`
- Create: `apps/core-api/src/modules/connector/connector.service.spec.ts`

- [ ] **Step 1: Write failing tests for ConnectorService**

Create `apps/core-api/src/modules/connector/connector.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConnectorService } from './connector.service';
import { PrismaService } from '@omaha/db';
import { NotFoundException } from '@nestjs/common';

describe('ConnectorService', () => {
  let service: ConnectorService;
  let prisma: {
    connector: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      connector: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectorService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get<ConnectorService>(ConnectorService);
  });

  describe('listConnectors', () => {
    it('should return all connectors for a tenant', async () => {
      const connectors = [{ id: 'c1', name: 'erp-db', type: 'postgresql' }];
      prisma.connector.findMany.mockResolvedValue(connectors);
      const result = await service.listConnectors('t1');
      expect(result).toEqual(connectors);
      expect(prisma.connector.findMany).toHaveBeenCalledWith({
        where: { tenantId: 't1' },
        orderBy: { name: 'asc' },
      });
    });
  });

  describe('getConnector', () => {
    it('should return connector by id', async () => {
      const conn = { id: 'c1', tenantId: 't1', name: 'erp-db' };
      prisma.connector.findUnique.mockResolvedValue(conn);
      const result = await service.getConnector('t1', 'c1');
      expect(result).toEqual(conn);
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.connector.findUnique.mockResolvedValue(null);
      await expect(service.getConnector('t1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createConnector', () => {
    it('should create and return connector', async () => {
      const created = { id: 'c1', tenantId: 't1', name: 'erp-db', type: 'postgresql', config: { host: 'localhost' }, status: 'inactive' };
      prisma.connector.create.mockResolvedValue(created);
      const result = await service.createConnector('t1', { name: 'erp-db', type: 'postgresql', config: { host: 'localhost' } });
      expect(result).toEqual(created);
    });
  });

  describe('updateConnector', () => {
    it('should update and return connector', async () => {
      const existing = { id: 'c1', tenantId: 't1' };
      prisma.connector.findUnique.mockResolvedValue(existing);
      const updated = { ...existing, name: 'erp-db-v2' };
      prisma.connector.update.mockResolvedValue(updated);
      const result = await service.updateConnector('t1', 'c1', { name: 'erp-db-v2' });
      expect(result).toEqual(updated);
    });
  });

  describe('deleteConnector', () => {
    it('should delete connector', async () => {
      const existing = { id: 'c1', tenantId: 't1' };
      prisma.connector.findUnique.mockResolvedValue(existing);
      prisma.connector.delete.mockResolvedValue(existing);
      await service.deleteConnector('t1', 'c1');
      expect(prisma.connector.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/wangfushuaiqi/omaha_ontocenter_v4 && pnpm --filter core-api test -- --testPathPattern=connector.service.spec`
Expected: FAIL — cannot find module `./connector.service`

- [ ] **Step 3: Implement ConnectorService**

Create `apps/core-api/src/modules/connector/connector.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { CreateConnectorRequest, UpdateConnectorRequest } from '@omaha/shared-types';

@Injectable()
export class ConnectorService {
  constructor(private readonly prisma: PrismaService) {}

  async listConnectors(tenantId: string) {
    return this.prisma.connector.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
  }

  async getConnector(tenantId: string, id: string) {
    const conn = await this.prisma.connector.findUnique({ where: { id } });
    if (!conn || conn.tenantId !== tenantId) throw new NotFoundException('Connector not found');
    return conn;
  }

  async createConnector(tenantId: string, dto: CreateConnectorRequest) {
    return this.prisma.connector.create({
      data: {
        tenantId,
        name: dto.name,
        type: dto.type,
        config: dto.config,
      },
    });
  }

  async updateConnector(tenantId: string, id: string, dto: UpdateConnectorRequest) {
    await this.getConnector(tenantId, id);
    return this.prisma.connector.update({
      where: { id },
      data: {
        ...dto.name !== undefined && { name: dto.name },
        ...dto.config !== undefined && { config: dto.config },
        ...dto.status !== undefined && { status: dto.status },
      },
    });
  }

  async deleteConnector(tenantId: string, id: string) {
    await this.getConnector(tenantId, id);
    return this.prisma.connector.delete({ where: { id } });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/wangfushuaiqi/omaha_ontocenter_v4 && pnpm --filter core-api test -- --testPathPattern=connector.service.spec`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/core-api/src/modules/connector/connector.service.ts apps/core-api/src/modules/connector/connector.service.spec.ts
git commit -m "feat: add ConnectorService with unit tests"
```

---

## Task 5: Connector DTOs, Controller, and Module

**Files:**
- Create: `apps/core-api/src/modules/connector/dto/create-connector.dto.ts`
- Create: `apps/core-api/src/modules/connector/dto/update-connector.dto.ts`
- Create: `apps/core-api/src/modules/connector/connector.controller.ts`
- Create: `apps/core-api/src/modules/connector/connector.module.ts`
- Modify: `apps/core-api/src/app.module.ts`

- [ ] **Step 1: Create DTOs**

Create `apps/core-api/src/modules/connector/dto/create-connector.dto.ts`:

```typescript
import { IsString, IsObject, MinLength } from 'class-validator';

export class CreateConnectorDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @MinLength(1)
  type: string;

  @IsObject()
  config: Record<string, unknown>;
}
```

Create `apps/core-api/src/modules/connector/dto/update-connector.dto.ts`:

```typescript
import { IsString, IsObject, IsOptional, MinLength } from 'class-validator';

export class UpdateConnectorDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  status?: string;
}
```

- [ ] **Step 2: Create ConnectorController**

Create `apps/core-api/src/modules/connector/connector.controller.ts`:

```typescript
import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ConnectorService } from './connector.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateConnectorDto } from './dto/create-connector.dto';
import { UpdateConnectorDto } from './dto/update-connector.dto';

@Controller('connectors')
@UseGuards(JwtAuthGuard)
export class ConnectorController {
  constructor(private readonly connectorService: ConnectorService) {}

  @Get()
  list(@CurrentUser('tenantId') tenantId: string) {
    return this.connectorService.listConnectors(tenantId);
  }

  @Get(':id')
  get(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.connectorService.getConnector(tenantId, id);
  }

  @Post()
  create(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateConnectorDto) {
    return this.connectorService.createConnector(tenantId, dto);
  }

  @Put(':id')
  update(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string, @Body() dto: UpdateConnectorDto) {
    return this.connectorService.updateConnector(tenantId, id, dto);
  }

  @Delete(':id')
  delete(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.connectorService.deleteConnector(tenantId, id);
  }
}
```

- [ ] **Step 3: Create ConnectorModule and register in AppModule**

Create `apps/core-api/src/modules/connector/connector.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConnectorController } from './connector.controller';
import { ConnectorService } from './connector.service';

@Module({
  controllers: [ConnectorController],
  providers: [ConnectorService],
  exports: [ConnectorService],
})
export class ConnectorModule {}
```

Modify `apps/core-api/src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from './common/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { OntologyModule } from './modules/ontology/ontology.module';
import { ConnectorModule } from './modules/connector/connector.module';

@Module({
  imports: [PrismaModule, AuthModule, TenantModule, OntologyModule, ConnectorModule],
})
export class AppModule {}
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/wangfushuaiqi/omaha_ontocenter_v4 && pnpm --filter core-api build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/core-api/src/modules/connector/ apps/core-api/src/app.module.ts
git commit -m "feat: add connector module with controller and DTOs"
```

---

## Task 6: Mapping Service — Unit Tests and Implementation

**Files:**
- Create: `apps/core-api/src/modules/mapping/mapping.service.ts`
- Create: `apps/core-api/src/modules/mapping/mapping.service.spec.ts`

- [ ] **Step 1: Write failing tests for MappingService**

Create `apps/core-api/src/modules/mapping/mapping.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { MappingService } from './mapping.service';
import { PrismaService } from '@omaha/db';
import { NotFoundException } from '@nestjs/common';

describe('MappingService', () => {
  let service: MappingService;
  let prisma: {
    objectMapping: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      objectMapping: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MappingService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get<MappingService>(MappingService);
  });

  describe('listMappings', () => {
    it('should return all mappings for a tenant', async () => {
      const mappings = [{ id: 'm1', tableName: 'customers' }];
      prisma.objectMapping.findMany.mockResolvedValue(mappings);
      const result = await service.listMappings('t1');
      expect(result).toEqual(mappings);
      expect(prisma.objectMapping.findMany).toHaveBeenCalledWith({
        where: { tenantId: 't1' },
        include: { objectType: true, connector: true },
      });
    });
  });

  describe('getMapping', () => {
    it('should return mapping by id', async () => {
      const mapping = { id: 'm1', tenantId: 't1', tableName: 'customers' };
      prisma.objectMapping.findUnique.mockResolvedValue(mapping);
      const result = await service.getMapping('t1', 'm1');
      expect(result).toEqual(mapping);
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.objectMapping.findUnique.mockResolvedValue(null);
      await expect(service.getMapping('t1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createMapping', () => {
    it('should create and return mapping', async () => {
      const created = { id: 'm1', tenantId: 't1', objectTypeId: 'ot1', connectorId: 'c1', tableName: 'customers', propertyMappings: {}, relationshipMappings: {} };
      prisma.objectMapping.create.mockResolvedValue(created);
      const result = await service.createMapping('t1', { objectTypeId: 'ot1', connectorId: 'c1', tableName: 'customers', propertyMappings: {} });
      expect(result).toEqual(created);
    });
  });

  describe('deleteMapping', () => {
    it('should delete mapping', async () => {
      const existing = { id: 'm1', tenantId: 't1' };
      prisma.objectMapping.findUnique.mockResolvedValue(existing);
      prisma.objectMapping.delete.mockResolvedValue(existing);
      await service.deleteMapping('t1', 'm1');
      expect(prisma.objectMapping.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/wangfushuaiqi/omaha_ontocenter_v4 && pnpm --filter core-api test -- --testPathPattern=mapping.service.spec`
Expected: FAIL — cannot find module `./mapping.service`

- [ ] **Step 3: Implement MappingService**

Create `apps/core-api/src/modules/mapping/mapping.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { CreateMappingRequest } from '@omaha/shared-types';

@Injectable()
export class MappingService {
  constructor(private readonly prisma: PrismaService) {}

  async listMappings(tenantId: string) {
    return this.prisma.objectMapping.findMany({
      where: { tenantId },
      include: { objectType: true, connector: true },
    });
  }

  async getMapping(tenantId: string, id: string) {
    const mapping = await this.prisma.objectMapping.findUnique({
      where: { id },
      include: { objectType: true, connector: true },
    });
    if (!mapping || mapping.tenantId !== tenantId) throw new NotFoundException('Mapping not found');
    return mapping;
  }

  async createMapping(tenantId: string, dto: CreateMappingRequest) {
    return this.prisma.objectMapping.create({
      data: {
        tenantId,
        objectTypeId: dto.objectTypeId,
        connectorId: dto.connectorId,
        tableName: dto.tableName,
        propertyMappings: dto.propertyMappings,
        relationshipMappings: dto.relationshipMappings ?? {},
      },
    });
  }

  async deleteMapping(tenantId: string, id: string) {
    await this.getMapping(tenantId, id);
    return this.prisma.objectMapping.delete({ where: { id } });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/wangfushuaiqi/omaha_ontocenter_v4 && pnpm --filter core-api test -- --testPathPattern=mapping.service.spec`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/core-api/src/modules/mapping/mapping.service.ts apps/core-api/src/modules/mapping/mapping.service.spec.ts
git commit -m "feat: add MappingService with unit tests"
```

---

## Task 7: Mapping DTOs, Controller, and Module

**Files:**
- Create: `apps/core-api/src/modules/mapping/dto/create-mapping.dto.ts`
- Create: `apps/core-api/src/modules/mapping/mapping.controller.ts`
- Create: `apps/core-api/src/modules/mapping/mapping.module.ts`
- Modify: `apps/core-api/src/app.module.ts`

- [ ] **Step 1: Create DTO**

Create `apps/core-api/src/modules/mapping/dto/create-mapping.dto.ts`:

```typescript
import { IsString, IsUUID, IsObject, IsOptional, MinLength } from 'class-validator';

export class CreateMappingDto {
  @IsUUID()
  objectTypeId: string;

  @IsUUID()
  connectorId: string;

  @IsString()
  @MinLength(1)
  tableName: string;

  @IsObject()
  propertyMappings: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  relationshipMappings?: Record<string, unknown>;
}
```

- [ ] **Step 2: Create MappingController**

Create `apps/core-api/src/modules/mapping/mapping.controller.ts`:

```typescript
import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { MappingService } from './mapping.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateMappingDto } from './dto/create-mapping.dto';

@Controller('mappings')
@UseGuards(JwtAuthGuard)
export class MappingController {
  constructor(private readonly mappingService: MappingService) {}

  @Get()
  list(@CurrentUser('tenantId') tenantId: string) {
    return this.mappingService.listMappings(tenantId);
  }

  @Get(':id')
  get(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.mappingService.getMapping(tenantId, id);
  }

  @Post()
  create(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateMappingDto) {
    return this.mappingService.createMapping(tenantId, dto);
  }

  @Delete(':id')
  delete(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.mappingService.deleteMapping(tenantId, id);
  }
}
```

- [ ] **Step 3: Create MappingModule and register in AppModule**

Create `apps/core-api/src/modules/mapping/mapping.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { MappingController } from './mapping.controller';
import { MappingService } from './mapping.service';

@Module({
  controllers: [MappingController],
  providers: [MappingService],
  exports: [MappingService],
})
export class MappingModule {}
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

@Module({
  imports: [PrismaModule, AuthModule, TenantModule, OntologyModule, ConnectorModule, MappingModule],
})
export class AppModule {}
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/wangfushuaiqi/omaha_ontocenter_v4 && pnpm --filter core-api build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/core-api/src/modules/mapping/ apps/core-api/src/app.module.ts
git commit -m "feat: add mapping module with controller and DTOs"
```

---

## Task 8: Extend Seed Data with Demo Ontology and Object Instances

**Files:**
- Modify: `packages/db/seed.ts`

- [ ] **Step 1: Add ObjectType seeds**

Add to `packages/db/seed.ts` after the user seeds, inside the `main()` function:

```typescript
  // --- Ontology: ObjectTypes ---
  const customerType = await prisma.objectType.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'customer' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'customer',
      label: '客户',
      properties: [
        { name: 'name', label: '客户名称', type: 'string', required: true },
        { name: 'contact', label: '联系人', type: 'string' },
        { name: 'phone', label: '电话', type: 'string' },
        { name: 'region', label: '区域', type: 'string' },
        { name: 'level', label: '客户等级', type: 'string' },
      ],
    },
  });

  const productType = await prisma.objectType.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'product' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'product',
      label: '产品',
      properties: [
        { name: 'name', label: '产品名称', type: 'string', required: true },
        { name: 'sku', label: 'SKU', type: 'string', required: true },
        { name: 'category', label: '分类', type: 'string' },
        { name: 'price', label: '单价', type: 'number' },
        { name: 'unit', label: '单位', type: 'string' },
      ],
    },
  });

  const orderType = await prisma.objectType.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'order' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'order',
      label: '订单',
      properties: [
        { name: 'orderNo', label: '订单编号', type: 'string', required: true },
        { name: 'orderDate', label: '下单日期', type: 'date', required: true },
        { name: 'totalAmount', label: '总金额', type: 'number' },
        { name: 'status', label: '状态', type: 'string' },
      ],
      derivedProperties: [
        { name: 'itemCount', label: '商品数量', type: 'number' },
      ],
    },
  });
```

- [ ] **Step 2: Add ObjectRelationship seeds**

Continue in `main()`:

```typescript
  // --- Ontology: Relationships ---
  await prisma.objectRelationship.upsert({
    where: { tenantId_sourceTypeId_name: { tenantId: tenant.id, sourceTypeId: customerType.id, name: 'has_orders' } },
    update: {},
    create: {
      tenantId: tenant.id,
      sourceTypeId: customerType.id,
      targetTypeId: orderType.id,
      name: 'has_orders',
      cardinality: 'one-to-many',
    },
  });

  await prisma.objectRelationship.upsert({
    where: { tenantId_sourceTypeId_name: { tenantId: tenant.id, sourceTypeId: orderType.id, name: 'contains_products' } },
    update: {},
    create: {
      tenantId: tenant.id,
      sourceTypeId: orderType.id,
      targetTypeId: productType.id,
      name: 'contains_products',
      cardinality: 'many-to-many',
    },
  });
```

- [ ] **Step 3: Add Connector and Mapping seeds**

Continue in `main()`:

```typescript
  // --- Connector ---
  const connector = await prisma.connector.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'demo-erp' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'demo-erp',
      type: 'postgresql',
      config: { host: 'localhost', port: 5432, database: 'erp_demo' },
      status: 'active',
    },
  });

  // --- Mappings ---
  await prisma.objectMapping.upsert({
    where: { tenantId_objectTypeId_connectorId: { tenantId: tenant.id, objectTypeId: customerType.id, connectorId: connector.id } },
    update: {},
    create: {
      tenantId: tenant.id,
      objectTypeId: customerType.id,
      connectorId: connector.id,
      tableName: 'erp_customers',
      propertyMappings: {
        name: { objectProperty: 'name', sourceColumn: 'customer_name' },
        contact: { objectProperty: 'contact', sourceColumn: 'contact_person' },
        phone: { objectProperty: 'phone', sourceColumn: 'phone_number' },
        region: { objectProperty: 'region', sourceColumn: 'region' },
        level: { objectProperty: 'level', sourceColumn: 'customer_level' },
      },
    },
  });
```

- [ ] **Step 4: Add sample ObjectInstance seeds**

Continue in `main()`:

```typescript
  // --- Sample ObjectInstances ---
  const customers = [
    { externalId: 'C001', label: '华东科技有限公司', properties: { name: '华东科技有限公司', contact: '张三', phone: '13800138001', region: '华东', level: 'A' } },
    { externalId: 'C002', label: '南方贸易集团', properties: { name: '南方贸易集团', contact: '李四', phone: '13800138002', region: '华南', level: 'B' } },
    { externalId: 'C003', label: '北方工业有限公司', properties: { name: '北方工业有限公司', contact: '王五', phone: '13800138003', region: '华北', level: 'A' } },
  ];

  for (const c of customers) {
    await prisma.objectInstance.upsert({
      where: { tenantId_objectType_externalId: { tenantId: tenant.id, objectType: 'customer', externalId: c.externalId } },
      update: {},
      create: {
        tenantId: tenant.id,
        objectType: 'customer',
        externalId: c.externalId,
        label: c.label,
        properties: c.properties,
        searchText: `${c.properties.name} ${c.properties.contact} ${c.properties.region}`,
      },
    });
  }

  const products = [
    { externalId: 'P001', label: '工业传感器A型', properties: { name: '工业传感器A型', sku: 'SENSOR-A', category: '传感器', price: 2500, unit: '个' } },
    { externalId: 'P002', label: '控制模块B型', properties: { name: '控制模块B型', sku: 'CTRL-B', category: '控制器', price: 8000, unit: '套' } },
  ];

  for (const p of products) {
    await prisma.objectInstance.upsert({
      where: { tenantId_objectType_externalId: { tenantId: tenant.id, objectType: 'product', externalId: p.externalId } },
      update: {},
      create: {
        tenantId: tenant.id,
        objectType: 'product',
        externalId: p.externalId,
        label: p.label,
        properties: p.properties,
        searchText: `${p.properties.name} ${p.properties.sku} ${p.properties.category}`,
      },
    });
  }

  const orders = [
    { externalId: 'O2024001', label: '订单 O2024001', properties: { orderNo: 'O2024001', orderDate: '2024-03-15', totalAmount: 75000, status: '已完成' }, relationships: { customer: 'C001', products: ['P001', 'P002'] } },
    { externalId: 'O2024002', label: '订单 O2024002', properties: { orderNo: 'O2024002', orderDate: '2024-04-20', totalAmount: 25000, status: '进行中' }, relationships: { customer: 'C002', products: ['P001'] } },
  ];

  for (const o of orders) {
    await prisma.objectInstance.upsert({
      where: { tenantId_objectType_externalId: { tenantId: tenant.id, objectType: 'order', externalId: o.externalId } },
      update: {},
      create: {
        tenantId: tenant.id,
        objectType: 'order',
        externalId: o.externalId,
        label: o.label,
        properties: o.properties,
        relationships: o.relationships,
        searchText: `${o.properties.orderNo} ${o.properties.status}`,
      },
    });
  }

  console.log('Seed complete: tenant=%s, objectTypes=3, relationships=2, instances=7', tenant.slug);
```

- [ ] **Step 5: Run seed**

Run: `cd /Users/wangfushuaiqi/omaha_ontocenter_v4 && pnpm --filter @omaha/db db:seed`
Expected: `Seed complete: tenant=demo, objectTypes=3, relationships=2, instances=7`

- [ ] **Step 6: Commit**

```bash
git add packages/db/seed.ts
git commit -m "feat: seed demo ontology types, relationships, and object instances"
```

---

## Task 9: E2E Tests for Ontology, Connector, and Mapping

**Files:**
- Create: `apps/core-api/test/ontology.e2e-spec.ts`
- Create: `apps/core-api/test/connector.e2e-spec.ts`
- Create: `apps/core-api/test/mapping.e2e-spec.ts`

- [ ] **Step 1: Create ontology E2E tests**

Create `apps/core-api/test/ontology.e2e-spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Ontology (e2e)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@demo.com', password: 'admin123', tenantSlug: 'demo' });
    token = loginRes.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /ontology/types — should list object types', async () => {
    const res = await request(app.getHttpServer())
      .get('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(3);
    expect(res.body.find((t: any) => t.name === 'customer')).toBeDefined();
  });

  it('POST /ontology/types — should create a new object type', async () => {
    const res = await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'supplier',
        label: '供应商',
        properties: [{ name: 'name', label: '名称', type: 'string', required: true }],
      })
      .expect(201);

    expect(res.body.name).toBe('supplier');
    expect(res.body.id).toBeDefined();

    // Cleanup
    await request(app.getHttpServer())
      .delete(`/ontology/types/${res.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('GET /ontology/relationships — should list relationships', async () => {
    const res = await request(app.getHttpServer())
      .get('/ontology/relationships')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  it('GET /ontology/types — should return 401 without token', () => {
    return request(app.getHttpServer())
      .get('/ontology/types')
      .expect(401);
  });
});
```

- [ ] **Step 2: Create connector E2E tests**

Create `apps/core-api/test/connector.e2e-spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Connector (e2e)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@demo.com', password: 'admin123', tenantSlug: 'demo' });
    token = loginRes.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /connectors — should list connectors', async () => {
    const res = await request(app.getHttpServer())
      .get('/connectors')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.find((c: any) => c.name === 'demo-erp')).toBeDefined();
  });

  it('POST /connectors — should create a new connector', async () => {
    const res = await request(app.getHttpServer())
      .post('/connectors')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'test-mysql',
        type: 'mysql',
        config: { host: 'localhost', port: 3306 },
      })
      .expect(201);

    expect(res.body.name).toBe('test-mysql');
    expect(res.body.status).toBe('inactive');

    // Cleanup
    await request(app.getHttpServer())
      .delete(`/connectors/${res.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('GET /connectors — should return 401 without token', () => {
    return request(app.getHttpServer())
      .get('/connectors')
      .expect(401);
  });
});
```

- [ ] **Step 3: Create mapping E2E tests**

Create `apps/core-api/test/mapping.e2e-spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Mapping (e2e)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@demo.com', password: 'admin123', tenantSlug: 'demo' });
    token = loginRes.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /mappings — should list mappings', async () => {
    const res = await request(app.getHttpServer())
      .get('/mappings')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].objectType).toBeDefined();
    expect(res.body[0].connector).toBeDefined();
  });

  it('GET /mappings — should return 401 without token', () => {
    return request(app.getHttpServer())
      .get('/mappings')
      .expect(401);
  });
});
```

- [ ] **Step 4: Run all E2E tests**

Run: `cd /Users/wangfushuaiqi/omaha_ontocenter_v4 && pnpm --filter core-api test:e2e`
Expected: All E2E tests pass (auth + ontology + connector + mapping).

- [ ] **Step 5: Run all unit tests to verify no regressions**

Run: `cd /Users/wangfushuaiqi/omaha_ontocenter_v4 && pnpm --filter core-api test`
Expected: All unit tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/core-api/test/ontology.e2e-spec.ts apps/core-api/test/connector.e2e-spec.ts apps/core-api/test/mapping.e2e-spec.ts
git commit -m "test: add E2E tests for ontology, connector, and mapping modules"
```
