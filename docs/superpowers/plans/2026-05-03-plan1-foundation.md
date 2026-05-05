# Plan 1: Foundation — Monorepo, Database, Auth & Tenant

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the Turborepo monorepo with PostgreSQL, Prisma schema for all 14 tables, NestJS core-api with working JWT auth and tenant isolation.

**Architecture:** Turborepo monorepo with 3 apps (core-api, agent-worker placeholder, web placeholder) and 2 shared packages (db, shared-types). Core-api is NestJS with Prisma ORM. PostgreSQL runs in Docker Compose.

**Tech Stack:** Turborepo, pnpm, NestJS 10, Prisma, PostgreSQL 16, passport-jwt, Docker Compose, Jest

---

## Plan Sequence (6 Plans Total)

| Plan | Status |
|------|--------|
| **Plan 1: Foundation** (this plan) | Current |
| Plan 2: Ontology & Mapping | Pending |
| Plan 3: Query Engine + Permissions | Pending |
| Plan 4: Agent Worker + Skills | Pending |
| Plan 5: Action Engine + Audit | Pending |
| Plan 6: Frontend (Next.js) | Pending |

---

## File Structure (Plan 1)

```
omaha-ontocenter/
├── package.json                    # Turborepo root
├── pnpm-workspace.yaml
├── turbo.json
├── docker-compose.yml
├── .env.example
├── .env
├── .gitignore
│
├── packages/
│   ├── db/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── prisma/
│   │   │   └── schema.prisma       # All 14 tables
│   │   ├── src/
│   │   │   ├── index.ts             # Re-exports PrismaClient + service
│   │   │   └── prisma.service.ts    # NestJS-injectable Prisma service
│   │   └── seed.ts                  # Seed script: demo tenant + admin user
│   │
│   └── shared-types/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── auth.ts              # User, Tenant, Role, LoginRequest/Response
│           └── common.ts            # Shared enums, pagination types
│
├── apps/
│   ├── core-api/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── tsconfig.build.json
│   │   ├── nest-cli.json
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── common/
│   │   │   │   └── decorators/
│   │   │   │       └── current-user.decorator.ts
│   │   │   └── modules/
│   │   │       ├── auth/
│   │   │       │   ├── auth.module.ts
│   │   │       │   ├── auth.controller.ts
│   │   │       │   ├── auth.service.ts
│   │   │       │   ├── auth.service.spec.ts
│   │   │       │   ├── auth.controller.spec.ts
│   │   │       │   ├── jwt.strategy.ts
│   │   │       │   ├── guards/
│   │   │       │   │   ├── jwt-auth.guard.ts
│   │   │       │   │   └── tenant.guard.ts
│   │   │       │   └── dto/
│   │   │       │       └── login.dto.ts
│   │   │       └── tenant/
│   │   │           ├── tenant.module.ts
│   │   │           ├── tenant.controller.ts
│   │   │           ├── tenant.service.ts
│   │   │           └── tenant.service.spec.ts
│   │   └── test/
│   │       ├── app.e2e-spec.ts
│   │       └── jest-e2e.json
│   ├── agent-worker/                # Placeholder for Plan 4
│   │   └── package.json
│   └── web/                         # Placeholder for Plan 6
│       └── package.json
│
└── seeds/
    └── demo-data.ts                 # Demo tenant, users, roles
```

---

## Task 1: Initialize Monorepo

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Initialize git repo and root package.json**

```bash
cd /path/to/omaha-ontocenter
git init
```

```json
// package.json
{
  "name": "omaha-ontocenter",
  "private": true,
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "test": "turbo test",
    "lint": "turbo lint",
    "db:generate": "pnpm --filter @omaha/db prisma generate",
    "db:migrate": "pnpm --filter @omaha/db prisma migrate dev",
    "db:push": "pnpm --filter @omaha/db prisma db push",
    "db:seed": "pnpm --filter @omaha/db seed"
  },
  "devDependencies": {
    "turbo": "^2.4.0"
  },
  "packageManager": "pnpm@9.15.0"
}
```

- [ ] **Step 2: Create pnpm workspace config**

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 3: Create turbo.json**

```json
// turbo.json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "lint": {}
  }
}
```

- [ ] **Step 4: Create .gitignore and .env.example**

```gitignore
# .gitignore
node_modules/
dist/
.env
*.log
.turbo/
.superpowers/
```

```bash
# .env.example
DATABASE_URL=postgresql://omaha:omaha@localhost:5432/ontocenter?schema=public
JWT_SECRET=change-me-in-production
JWT_EXPIRES_IN=7d
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=your-key-here
```

- [ ] **Step 5: Install turbo and verify**

```bash
pnpm install
pnpm turbo --version
```

Expected: turbo version prints successfully.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml turbo.json .gitignore .env.example pnpm-lock.yaml
git commit -m "chore: initialize turborepo monorepo"
```

---

## Task 2: Docker Compose + PostgreSQL

**Files:**
- Create: `docker-compose.yml`
- Create: `.env` (local copy)

- [ ] **Step 1: Create docker-compose.yml**

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: omaha
      POSTGRES_PASSWORD: omaha
      POSTGRES_DB: ontocenter
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

- [ ] **Step 2: Create local .env**

```bash
cp .env.example .env
```

- [ ] **Step 3: Start PostgreSQL and verify**

```bash
docker compose up -d
docker compose exec postgres psql -U omaha -d ontocenter -c "SELECT 1"
```

Expected: Returns `1` confirming PostgreSQL is running.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "infra: add docker-compose with PostgreSQL 16"
```

---

## Task 3: Prisma Schema (packages/db)

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/prisma/schema.prisma`
- Create: `packages/db/src/index.ts`
- Create: `packages/db/src/prisma.service.ts`

- [ ] **Step 1: Create packages/db/package.json**

```json
{
  "name": "@omaha/db",
  "version": "0.0.1",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "generate": "prisma generate",
    "migrate": "prisma migrate dev",
    "push": "prisma db push",
    "seed": "tsx seed.ts",
    "studio": "prisma studio"
  },
  "dependencies": {
    "@prisma/client": "^6.3.0"
  },
  "devDependencies": {
    "prisma": "^6.3.0",
    "tsx": "^4.19.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
// packages/db/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create Prisma schema — Auth & Tenant tables**

```prisma
// packages/db/prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Tenant {
  id        String   @id @default(uuid()) @db.Uuid
  name      String
  slug      String   @unique
  settings  Json     @default("{}")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  users              User[]
  roles              Role[]
  objectTypes        ObjectType[]
  objectRelationships ObjectRelationship[]
  connectors         Connector[]
  objectMappings     ObjectMapping[]
  objectInstances    ObjectInstance[]
  syncJobs           SyncJob[]
  conversations      Conversation[]
  skillDefinitions   SkillDefinition[]
  auditLogs          AuditLog[]
  actionDefinitions  ActionDefinition[]
  actionPreviews     ActionPreview[]
  actionRuns         ActionRun[]

  @@map("tenants")
}

model Role {
  id          String   @id @default(uuid()) @db.Uuid
  tenantId    String   @map("tenant_id") @db.Uuid
  name        String
  permissions Json     @default("[]")
  createdAt   DateTime @default(now()) @map("created_at")

  tenant Tenant @relation(fields: [tenantId], references: [id])
  users  User[]

  @@unique([tenantId, name])
  @@map("roles")
}

model User {
  id           String   @id @default(uuid()) @db.Uuid
  tenantId     String   @map("tenant_id") @db.Uuid
  email        String
  name         String
  passwordHash String   @map("password_hash")
  roleId       String   @map("role_id") @db.Uuid
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  tenant        Tenant         @relation(fields: [tenantId], references: [id])
  role          Role           @relation(fields: [roleId], references: [id])
  conversations Conversation[]
  auditLogs     AuditLog[]
  actionPreviews ActionPreview[]
  actionRuns    ActionRun[]

  @@unique([tenantId, email])
  @@map("users")
}
```

- [ ] **Step 4: Add Ontology & Mapping tables to schema**

Append to `packages/db/prisma/schema.prisma`:

```prisma
model ObjectType {
  id                String   @id @default(uuid()) @db.Uuid
  tenantId          String   @map("tenant_id") @db.Uuid
  name              String
  label             String
  properties        Json     @default("[]")
  derivedProperties Json     @default("[]") @map("derived_properties")
  version           Int      @default(1)
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  tenant          Tenant              @relation(fields: [tenantId], references: [id])
  sourceRelations ObjectRelationship[] @relation("SourceType")
  targetRelations ObjectRelationship[] @relation("TargetType")
  mappings        ObjectMapping[]

  @@unique([tenantId, name])
  @@map("object_types")
}

model ObjectRelationship {
  id           String   @id @default(uuid()) @db.Uuid
  tenantId     String   @map("tenant_id") @db.Uuid
  sourceTypeId String   @map("source_type_id") @db.Uuid
  targetTypeId String   @map("target_type_id") @db.Uuid
  name         String
  cardinality  String
  createdAt    DateTime @default(now()) @map("created_at")

  tenant     Tenant     @relation(fields: [tenantId], references: [id])
  sourceType ObjectType @relation("SourceType", fields: [sourceTypeId], references: [id])
  targetType ObjectType @relation("TargetType", fields: [targetTypeId], references: [id])

  @@unique([tenantId, sourceTypeId, name])
  @@map("object_relationships")
}

model Connector {
  id        String   @id @default(uuid()) @db.Uuid
  tenantId  String   @map("tenant_id") @db.Uuid
  name      String
  type      String
  config    Json     @default("{}")
  status    String   @default("inactive")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  tenant   Tenant          @relation(fields: [tenantId], references: [id])
  mappings ObjectMapping[]
  syncJobs SyncJob[]

  @@unique([tenantId, name])
  @@map("connectors")
}

model ObjectMapping {
  id                   String   @id @default(uuid()) @db.Uuid
  tenantId             String   @map("tenant_id") @db.Uuid
  objectTypeId         String   @map("object_type_id") @db.Uuid
  connectorId          String   @map("connector_id") @db.Uuid
  tableName            String   @map("table_name")
  propertyMappings     Json     @default("{}") @map("property_mappings")
  relationshipMappings Json     @default("{}") @map("relationship_mappings")
  createdAt            DateTime @default(now()) @map("created_at")

  tenant     Tenant     @relation(fields: [tenantId], references: [id])
  objectType ObjectType @relation(fields: [objectTypeId], references: [id])
  connector  Connector  @relation(fields: [connectorId], references: [id])

  @@unique([tenantId, objectTypeId, connectorId])
  @@map("object_mappings")
}
```

- [ ] **Step 5: Add Object Instances & Sync tables**

Append to `packages/db/prisma/schema.prisma`:

```prisma
model ObjectInstance {
  id           String   @id @default(uuid()) @db.Uuid
  tenantId     String   @map("tenant_id") @db.Uuid
  objectType   String   @map("object_type")
  externalId   String   @map("external_id")
  label        String?
  properties   Json     @default("{}")
  relationships Json    @default("{}")
  sourceRef    Json?    @map("source_ref")
  searchText   String?  @map("search_text")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  tenant Tenant @relation(fields: [tenantId], references: [id])

  @@unique([tenantId, objectType, externalId])
  @@index([tenantId, objectType])
  @@map("object_instances")
}

model SyncJob {
  id               String    @id @default(uuid()) @db.Uuid
  tenantId         String    @map("tenant_id") @db.Uuid
  connectorId      String    @map("connector_id") @db.Uuid
  status           String    @default("pending")
  startedAt        DateTime? @map("started_at")
  completedAt      DateTime? @map("completed_at")
  recordsProcessed Int       @default(0) @map("records_processed")
  recordsFailed    Int       @default(0) @map("records_failed")
  errorLog         Json?     @map("error_log")
  createdAt        DateTime  @default(now()) @map("created_at")

  tenant    Tenant    @relation(fields: [tenantId], references: [id])
  connector Connector @relation(fields: [connectorId], references: [id])

  @@map("sync_jobs")
}
```

- [ ] **Step 6: Add Agent, Skills & Audit tables**

Append to `packages/db/prisma/schema.prisma`:

```prisma
model Conversation {
  id        String   @id @default(uuid()) @db.Uuid
  tenantId  String   @map("tenant_id") @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  title     String?
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  tenant Tenant             @relation(fields: [tenantId], references: [id])
  user   User               @relation(fields: [userId], references: [id])
  turns  ConversationTurn[]

  @@map("conversations")
}

model ConversationTurn {
  id             String   @id @default(uuid()) @db.Uuid
  conversationId String   @map("conversation_id") @db.Uuid
  role           String
  content        String?
  toolCalls      Json?    @map("tool_calls")
  toolResults    Json?    @map("tool_results")
  createdAt      DateTime @default(now()) @map("created_at")

  conversation Conversation @relation(fields: [conversationId], references: [id])

  @@index([conversationId, createdAt])
  @@map("conversation_turns")
}

model SkillDefinition {
  id                String   @id @default(uuid()) @db.Uuid
  tenantId          String?  @map("tenant_id") @db.Uuid
  name              String
  description       String?
  triggerConditions Json?    @map("trigger_conditions")
  content           String
  isAlwaysOn        Boolean  @default(false) @map("is_always_on")
  priority          Int      @default(0)
  enabled           Boolean  @default(true)
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  tenant Tenant? @relation(fields: [tenantId], references: [id])

  @@map("skill_definitions")
}

model AuditLog {
  id          String   @id @default(uuid()) @db.Uuid
  tenantId    String   @map("tenant_id") @db.Uuid
  actorId     String   @map("actor_id") @db.Uuid
  actorType   String   @map("actor_type")
  operation   String
  objectType  String?  @map("object_type")
  queryPlan   Json?    @map("query_plan")
  resultCount Int?     @map("result_count")
  source      String?
  createdAt   DateTime @default(now()) @map("created_at")

  tenant Tenant @relation(fields: [tenantId], references: [id])
  actor  User   @relation(fields: [actorId], references: [id])

  @@index([tenantId, createdAt(sort: Desc)])
  @@map("audit_logs")
}
```

- [ ] **Step 7: Add Action Engine tables**

Append to `packages/db/prisma/schema.prisma`:

```prisma
model ActionDefinition {
  id                   String   @id @default(uuid()) @db.Uuid
  tenantId             String   @map("tenant_id") @db.Uuid
  name                 String
  label                String
  objectType           String   @map("object_type")
  inputSchema          Json     @default("{}") @map("input_schema")
  preconditions        Json     @default("[]")
  permission           String
  requiresConfirmation Boolean  @default(true) @map("requires_confirmation")
  riskLevel            String   @default("low") @map("risk_level")
  createdAt            DateTime @default(now()) @map("created_at")

  tenant   Tenant          @relation(fields: [tenantId], references: [id])
  previews ActionPreview[]

  @@unique([tenantId, name])
  @@map("action_definitions")
}

model ActionPreview {
  id            String    @id @default(uuid()) @db.Uuid
  tenantId      String    @map("tenant_id") @db.Uuid
  actionDefId   String    @map("action_def_id") @db.Uuid
  userId        String    @map("user_id") @db.Uuid
  targetIds     String[]  @map("target_ids") @db.Uuid
  inputParams   Json      @default("{}") @map("input_params")
  previewResult Json      @default("{}") @map("preview_result")
  status        String    @default("pending")
  expiresAt     DateTime  @map("expires_at")
  createdAt     DateTime  @default(now()) @map("created_at")

  tenant    Tenant           @relation(fields: [tenantId], references: [id])
  actionDef ActionDefinition @relation(fields: [actionDefId], references: [id])
  user      User             @relation(fields: [userId], references: [id])
  runs      ActionRun[]

  @@map("action_previews")
}

model ActionRun {
  id          String    @id @default(uuid()) @db.Uuid
  tenantId    String    @map("tenant_id") @db.Uuid
  previewId   String    @map("preview_id") @db.Uuid
  userId      String    @map("user_id") @db.Uuid
  status      String    @default("pending")
  result      Json?
  error       Json?
  startedAt   DateTime? @map("started_at")
  completedAt DateTime? @map("completed_at")
  createdAt   DateTime  @default(now()) @map("created_at")

  tenant  Tenant        @relation(fields: [tenantId], references: [id])
  preview ActionPreview @relation(fields: [previewId], references: [id])
  user    User          @relation(fields: [userId], references: [id])

  @@map("action_runs")
}
```

- [ ] **Step 8: Create PrismaService for NestJS**

```typescript
// packages/db/src/prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

```typescript
// packages/db/src/index.ts
export { PrismaService } from './prisma.service';
export { PrismaClient } from '@prisma/client';
export * from '@prisma/client';
```

- [ ] **Step 9: Install dependencies, generate client, run migration**

```bash
cd packages/db
pnpm install
pnpm prisma generate
pnpm prisma migrate dev --name init
```

Expected: Migration creates all 14 tables in PostgreSQL.

- [ ] **Step 10: Verify tables exist**

```bash
docker compose exec postgres psql -U omaha -d ontocenter -c "\dt"
```

Expected: Lists all tables (tenants, users, roles, object_types, etc.)

- [ ] **Step 11: Commit**

```bash
git add packages/db/
git commit -m "feat: add Prisma schema with all 14 tables"
```

---

## Task 4: Shared Types (packages/shared-types)

**Files:**
- Create: `packages/shared-types/package.json`
- Create: `packages/shared-types/tsconfig.json`
- Create: `packages/shared-types/src/index.ts`
- Create: `packages/shared-types/src/auth.ts`
- Create: `packages/shared-types/src/common.ts`

- [ ] **Step 1: Create package.json**

```json
// packages/shared-types/package.json
{
  "name": "@omaha/shared-types",
  "version": "0.0.1",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts"
}
```

```json
// packages/shared-types/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: Create auth types**

```typescript
// packages/shared-types/src/auth.ts
export interface LoginRequest {
  email: string;
  password: string;
  tenantSlug: string;
}

export interface LoginResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    name: string;
    tenantId: string;
    role: string;
  };
}

export interface JwtPayload {
  sub: string;
  email: string;
  tenantId: string;
  roleId: string;
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  tenantId: string;
  roleId: string;
  roleName: string;
  permissions: string[];
}
```

- [ ] **Step 3: Create common types**

```typescript
// packages/shared-types/src/common.ts
export interface PaginatedRequest {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}
```

```typescript
// packages/shared-types/src/index.ts
export * from './auth';
export * from './common';
```

- [ ] **Step 4: Commit**

```bash
git add packages/shared-types/
git commit -m "feat: add shared-types package with auth and common types"
```

---

## Task 5: Scaffold NestJS Core API

**Files:**
- Create: `apps/core-api/package.json`
- Create: `apps/core-api/tsconfig.json`
- Create: `apps/core-api/tsconfig.build.json`
- Create: `apps/core-api/nest-cli.json`
- Create: `apps/core-api/src/main.ts`
- Create: `apps/core-api/src/app.module.ts`
- Create: `apps/core-api/test/jest-e2e.json`

- [ ] **Step 1: Create package.json with NestJS dependencies**

```json
// apps/core-api/package.json
{
  "name": "@omaha/core-api",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "build": "nest build",
    "dev": "nest start --watch",
    "start": "nest start",
    "start:prod": "node dist/main",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:e2e": "jest --config ./test/jest-e2e.json"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.0",
    "@nestjs/core": "^10.4.0",
    "@nestjs/jwt": "^10.2.0",
    "@nestjs/passport": "^10.0.3",
    "@nestjs/platform-express": "^10.4.0",
    "@omaha/db": "workspace:*",
    "@omaha/shared-types": "workspace:*",
    "bcrypt": "^5.1.1",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "passport": "^0.7.0",
    "passport-jwt": "^4.0.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.4.0",
    "@nestjs/schematics": "^10.1.0",
    "@nestjs/testing": "^10.4.0",
    "@types/bcrypt": "^5.0.2",
    "@types/jest": "^29.5.12",
    "@types/node": "^22.0.0",
    "@types/passport-jwt": "^4.0.1",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Create TypeScript and NestJS configs**

```json
// apps/core-api/tsconfig.json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2022",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true
  }
}
```

```json
// apps/core-api/tsconfig.build.json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "test", "dist", "**/*spec.ts"]
}
```

```json
// apps/core-api/nest-cli.json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

- [ ] **Step 3: Create app.module.ts and main.ts**

```typescript
// apps/core-api/src/app.module.ts
import { Module } from '@nestjs/common';
import { PrismaService } from '@omaha/db';

@Module({
  providers: [
    {
      provide: PrismaService,
      useFactory: () => {
        const prisma = new PrismaService();
        return prisma;
      },
    },
  ],
  exports: [PrismaService],
})
export class AppModule {}
```

```typescript
// apps/core-api/src/main.ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors();
  await app.listen(3000);
}
bootstrap();
```

- [ ] **Step 4: Create e2e test config**

```json
// apps/core-api/test/jest-e2e.json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": {
    "^.+\\.(t|j)s$": "ts-jest"
  },
  "moduleNameMapper": {
    "^@omaha/db$": "<rootDir>/../../packages/db/src",
    "^@omaha/shared-types$": "<rootDir>/../../packages/shared-types/src"
  }
}
```

- [ ] **Step 5: Install dependencies and verify build**

```bash
cd apps/core-api
pnpm install
pnpm build
```

Expected: Build succeeds, `dist/` directory created.

- [ ] **Step 6: Verify app starts**

```bash
pnpm dev &
sleep 3
curl http://localhost:3000
kill %1
```

Expected: App starts on port 3000 (404 is fine — no routes yet).

- [ ] **Step 7: Commit**

```bash
git add apps/core-api/
git commit -m "feat: scaffold NestJS core-api with Prisma integration"
```

---

## Task 6: Auth Module (TDD)

**Files:**
- Create: `apps/core-api/src/modules/auth/dto/login.dto.ts`
- Create: `apps/core-api/src/modules/auth/jwt.strategy.ts`
- Create: `apps/core-api/src/modules/auth/guards/jwt-auth.guard.ts`
- Create: `apps/core-api/src/modules/auth/guards/tenant.guard.ts`
- Create: `apps/core-api/src/modules/auth/auth.service.ts`
- Create: `apps/core-api/src/modules/auth/auth.service.spec.ts`
- Create: `apps/core-api/src/modules/auth/auth.controller.ts`
- Create: `apps/core-api/src/modules/auth/auth.controller.spec.ts`
- Create: `apps/core-api/src/modules/auth/auth.module.ts`
- Create: `apps/core-api/src/common/decorators/current-user.decorator.ts`
- Modify: `apps/core-api/src/app.module.ts`

- [ ] **Step 1: Create login DTO**

```typescript
// apps/core-api/src/modules/auth/dto/login.dto.ts
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  tenantSlug: string;
}
```

- [ ] **Step 2: Write failing test for AuthService.validateUser**

```typescript
// apps/core-api/src/modules/auth/auth.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '@omaha/db';
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: { tenant: { findUnique: jest.Mock }; user: { findUnique: jest.Mock } };
  let jwtService: { sign: jest.Mock };

  beforeEach(async () => {
    prisma = {
      tenant: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
    };
    jwtService = { sign: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('login', () => {
    it('should throw UnauthorizedException when tenant not found', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'a@b.com', password: 'pass123', tenantSlug: 'bad' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when user not found', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1' });
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'a@b.com', password: 'pass123', tenantSlug: 'demo' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when password is wrong', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1' });
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        name: 'Test',
        tenantId: 't1',
        roleId: 'r1',
        passwordHash: await bcrypt.hash('correct', 10),
        role: { name: 'admin', permissions: [] },
      });

      await expect(
        service.login({ email: 'a@b.com', password: 'wrong', tenantSlug: 'demo' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should return token and user on valid credentials', async () => {
      const hash = await bcrypt.hash('pass123', 10);
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1' });
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        name: 'Test',
        tenantId: 't1',
        roleId: 'r1',
        passwordHash: hash,
        role: { name: 'admin', permissions: ['*'] },
      });
      jwtService.sign.mockReturnValue('jwt-token');

      const result = await service.login({
        email: 'a@b.com',
        password: 'pass123',
        tenantSlug: 'demo',
      });

      expect(result.accessToken).toBe('jwt-token');
      expect(result.user.email).toBe('a@b.com');
      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: 'u1',
        email: 'a@b.com',
        tenantId: 't1',
        roleId: 'r1',
      });
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd apps/core-api
pnpm test -- --testPathPattern=auth.service.spec
```

Expected: FAIL — `Cannot find module './auth.service'`

- [ ] **Step 4: Implement AuthService**

```typescript
// apps/core-api/src/modules/auth/auth.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '@omaha/db';
import { LoginResponse, JwtPayload } from '@omaha/shared-types';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto): Promise<LoginResponse> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: dto.tenantSlug },
    });
    if (!tenant) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const user = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email: dto.email } },
      include: { role: true },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      roleId: user.roleId,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        tenantId: user.tenantId,
        role: user.role.name,
      },
    };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/core-api
pnpm test -- --testPathPattern=auth.service.spec
```

Expected: All 4 tests PASS.

- [ ] **Step 6: Create JWT strategy and guards**

```typescript
// apps/core-api/src/modules/auth/jwt.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '@omaha/db';
import { JwtPayload, CurrentUser } from '@omaha/shared-types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthBearerToken(),
      secretOrKey: process.env.JWT_SECRET || 'dev-secret',
    });
  }

  async validate(payload: JwtPayload): Promise<CurrentUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: true },
    });
    if (!user) {
      throw new Error('User not found');
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      tenantId: user.tenantId,
      roleId: user.roleId,
      roleName: user.role.name,
      permissions: user.role.permissions as string[],
    };
  }
}
```

```typescript
// apps/core-api/src/modules/auth/guards/jwt-auth.guard.ts
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

```typescript
// apps/core-api/src/modules/auth/guards/tenant.guard.ts
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const tenantId = request.params.tenantId || request.body?.tenantId || request.query?.tenantId;

    if (tenantId && tenantId !== user.tenantId) {
      throw new ForbiddenException('Access denied to this tenant');
    }

    return true;
  }
}
```

- [ ] **Step 7: Create CurrentUser decorator**

```typescript
// apps/core-api/src/common/decorators/current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { CurrentUser as CurrentUserType } from '@omaha/shared-types';

export const CurrentUser = createParamDecorator(
  (data: keyof CurrentUserType | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as CurrentUserType;
    return data ? user[data] : user;
  },
);
```

- [ ] **Step 8: Create AuthController with test**

```typescript
// apps/core-api/src/modules/auth/auth.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: { login: jest.Mock };

  beforeEach(async () => {
    authService = { login: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();
    controller = module.get<AuthController>(AuthController);
  });

  it('should call authService.login and return result', async () => {
    const expected = { accessToken: 'tok', user: { id: '1', email: 'a@b.com', name: 'T', tenantId: 't1', role: 'admin' } };
    authService.login.mockResolvedValue(expected);

    const result = await controller.login({ email: 'a@b.com', password: 'pass123', tenantSlug: 'demo' });
    expect(result).toEqual(expected);
  });

  it('should return current user from /auth/me', () => {
    const user = { id: '1', email: 'a@b.com', name: 'T', tenantId: 't1', roleId: 'r1', roleName: 'admin', permissions: ['*'] };
    const result = controller.me(user as any);
    expect(result).toEqual(user);
  });
});
```

```typescript
// apps/core-api/src/modules/auth/auth.controller.ts
import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType, LoginResponse } from '@omaha/shared-types';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.authService.login(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: CurrentUserType): CurrentUserType {
    return user;
  }
}
```

- [ ] **Step 9: Run controller tests**

```bash
cd apps/core-api
pnpm test -- --testPathPattern=auth.controller.spec
```

Expected: All 2 tests PASS.

- [ ] **Step 10: Create AuthModule and wire into AppModule**

```typescript
// apps/core-api/src/modules/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaService } from '@omaha/db';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'dev-secret',
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, PrismaService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
```

Update `apps/core-api/src/app.module.ts`:

```typescript
// apps/core-api/src/app.module.ts
import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module';

@Module({
  imports: [AuthModule],
})
export class AppModule {}
```

- [ ] **Step 11: Run all tests**

```bash
cd apps/core-api
pnpm test
```

Expected: All 6 tests PASS (4 service + 2 controller).

- [ ] **Step 12: Commit**

```bash
git add apps/core-api/src/modules/auth/ apps/core-api/src/common/ apps/core-api/src/app.module.ts
git commit -m "feat: add auth module with JWT login, guards, and tests"
```

---

## Task 7: Tenant Module (TDD)

**Files:**
- Create: `apps/core-api/src/modules/tenant/tenant.service.ts`
- Create: `apps/core-api/src/modules/tenant/tenant.service.spec.ts`
- Create: `apps/core-api/src/modules/tenant/tenant.controller.ts`
- Create: `apps/core-api/src/modules/tenant/tenant.module.ts`
- Modify: `apps/core-api/src/app.module.ts`

- [ ] **Step 1: Write failing test for TenantService**

```typescript
// apps/core-api/src/modules/tenant/tenant.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { TenantService } from './tenant.service';
import { PrismaService } from '@omaha/db';

describe('TenantService', () => {
  let service: TenantService;
  let prisma: { tenant: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      tenant: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get<TenantService>(TenantService);
  });

  describe('findById', () => {
    it('should return tenant by id', async () => {
      const tenant = { id: 't1', name: 'Demo', slug: 'demo', settings: {} };
      prisma.tenant.findUnique.mockResolvedValue(tenant);

      const result = await service.findById('t1');
      expect(result).toEqual(tenant);
      expect(prisma.tenant.findUnique).toHaveBeenCalledWith({ where: { id: 't1' } });
    });
  });

  describe('updateSettings', () => {
    it('should update tenant settings', async () => {
      const updated = { id: 't1', name: 'Demo', slug: 'demo', settings: { timezone: 'Asia/Shanghai' } };
      prisma.tenant.update.mockResolvedValue(updated);

      const result = await service.updateSettings('t1', { timezone: 'Asia/Shanghai' });
      expect(result.settings).toEqual({ timezone: 'Asia/Shanghai' });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/core-api
pnpm test -- --testPathPattern=tenant.service.spec
```

Expected: FAIL — `Cannot find module './tenant.service'`

- [ ] **Step 3: Implement TenantService**

```typescript
// apps/core-api/src/modules/tenant/tenant.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService, Tenant } from '@omaha/db';

@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Tenant | null> {
    return this.prisma.tenant.findUnique({ where: { id } });
  }

  async updateSettings(id: string, settings: Record<string, unknown>): Promise<Tenant> {
    return this.prisma.tenant.update({
      where: { id },
      data: { settings },
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/core-api
pnpm test -- --testPathPattern=tenant.service.spec
```

Expected: All 2 tests PASS.

- [ ] **Step 5: Create TenantController**

```typescript
// apps/core-api/src/modules/tenant/tenant.controller.ts
import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '@omaha/shared-types';

@Controller('tenant')
@UseGuards(JwtAuthGuard)
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Get()
  async getCurrent(@CurrentUser('tenantId') tenantId: string) {
    return this.tenantService.findById(tenantId);
  }

  @Put('settings')
  async updateSettings(
    @CurrentUser('tenantId') tenantId: string,
    @Body() settings: Record<string, unknown>,
  ) {
    return this.tenantService.updateSettings(tenantId, settings);
  }
}
```

- [ ] **Step 6: Create TenantModule and wire into AppModule**

```typescript
// apps/core-api/src/modules/tenant/tenant.module.ts
import { Module } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';

@Module({
  controllers: [TenantController],
  providers: [TenantService, PrismaService],
  exports: [TenantService],
})
export class TenantModule {}
```

Update `apps/core-api/src/app.module.ts`:

```typescript
// apps/core-api/src/app.module.ts
import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module';
import { TenantModule } from './modules/tenant/tenant.module';

@Module({
  imports: [AuthModule, TenantModule],
})
export class AppModule {}
```

- [ ] **Step 7: Run all tests**

```bash
cd apps/core-api
pnpm test
```

Expected: All 8 tests PASS (4 auth service + 2 auth controller + 2 tenant service).

- [ ] **Step 8: Commit**

```bash
git add apps/core-api/src/modules/tenant/ apps/core-api/src/app.module.ts
git commit -m "feat: add tenant module with settings management"
```

---

## Task 8: Seed Data + E2E Test

**Files:**
- Create: `packages/db/seed.ts`
- Create: `apps/core-api/test/app.e2e-spec.ts`
- Create: `apps/agent-worker/package.json` (placeholder)
- Create: `apps/web/package.json` (placeholder)

- [ ] **Step 1: Create seed script**

```typescript
// packages/db/seed.ts
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo' },
    update: {},
    create: {
      name: 'Demo Company',
      slug: 'demo',
      settings: { timezone: 'Asia/Shanghai', language: 'zh-CN' },
    },
  });

  const adminRole = await prisma.role.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'admin' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'admin',
      permissions: ['*'],
    },
  });

  const opsRole = await prisma.role.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'operator' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'operator',
      permissions: ['object.read', 'object.query', 'action.preview'],
    },
  });

  const passwordHash = await bcrypt.hash('admin123', 10);

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@demo.com' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'admin@demo.com',
      name: 'Admin',
      passwordHash,
      roleId: adminRole.id,
    },
  });

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'ops@demo.com' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'ops@demo.com',
      name: 'Operator',
      passwordHash,
      roleId: opsRole.id,
    },
  });

  console.log('Seed complete: tenant=%s, admin=%s', tenant.slug, 'admin@demo.com');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Run seed**

```bash
cd packages/db
pnpm seed
```

Expected: `Seed complete: tenant=demo, admin=admin@demo.com`

- [ ] **Step 3: Write E2E test for login flow**

```typescript
// apps/core-api/test/app.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /auth/login — should return 401 for invalid credentials', () => {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'bad@bad.com', password: 'wrong', tenantSlug: 'demo' })
      .expect(401);
  });

  it('POST /auth/login — should return token for valid credentials', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@demo.com', password: 'admin123', tenantSlug: 'demo' })
      .expect(201);

    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.email).toBe('admin@demo.com');
  });

  it('GET /auth/me — should return current user with valid token', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@demo.com', password: 'admin123', tenantSlug: 'demo' });

    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
      .expect(200);

    expect(res.body.email).toBe('admin@demo.com');
    expect(res.body.tenantId).toBeDefined();
  });

  it('GET /auth/me — should return 401 without token', () => {
    return request(app.getHttpServer())
      .get('/auth/me')
      .expect(401);
  });
});
```

- [ ] **Step 4: Add supertest dev dependency**

```bash
cd apps/core-api
pnpm add -D supertest @types/supertest
```

- [ ] **Step 5: Run E2E tests**

```bash
cd apps/core-api
pnpm test:e2e
```

Expected: All 4 E2E tests PASS (requires PostgreSQL running with seed data).

- [ ] **Step 6: Create placeholder packages for agent-worker and web**

```json
// apps/agent-worker/package.json
{
  "name": "@omaha/agent-worker",
  "version": "0.0.1",
  "private": true,
  "dependencies": {
    "@omaha/db": "workspace:*",
    "@omaha/shared-types": "workspace:*"
  }
}
```

```json
// apps/web/package.json
{
  "name": "@omaha/web",
  "version": "0.0.1",
  "private": true
}
```

- [ ] **Step 7: Run full test suite from root**

```bash
cd /path/to/omaha-ontocenter
pnpm test
```

Expected: All unit tests pass across all packages.

- [ ] **Step 8: Final commit**

```bash
git add packages/db/seed.ts apps/core-api/test/ apps/agent-worker/ apps/web/
git commit -m "feat: add seed data, e2e tests, and app placeholders"
```

---

## Plan 1 Complete

After executing all 8 tasks, you will have:

- Turborepo monorepo with pnpm workspaces
- PostgreSQL 16 in Docker Compose with all 14 tables
- Prisma ORM with generated client and migrations
- Shared TypeScript types package
- NestJS core-api with:
  - JWT authentication (login + token validation)
  - Tenant isolation (guard + decorator)
  - 8 unit tests + 4 E2E tests passing
- Seed data: demo tenant, admin + operator users, 2 roles
- Placeholder packages for agent-worker and web

**Next:** Plan 2 (Ontology & Mapping) builds on this foundation.
