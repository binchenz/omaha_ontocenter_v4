import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@omaha/db';
import { createTestApp, ensureTestTenant, loginAsTestTenantAdmin, cleanupTestTenant } from './test-helpers';
import { ViewManagerService } from '../src/modules/ontology/view-manager.service';

export interface PropertySpec {
  name: string;
  type: string;
  label: string;
  filterable?: boolean;
  sortable?: boolean;
}

export interface ObjectTypeSpec {
  name: string;
  label: string;
  properties: PropertySpec[];
  derivedProperties?: Array<{ name: string; type: string; label: string; expression: string }>;
}

export interface InstanceSpec {
  externalId: string;
  label?: string;
  properties: Record<string, unknown>;
  relationships?: Record<string, unknown>;
}

export interface BuiltScenario {
  app: INestApplication;
  prisma: PrismaClient;
  tenantId: string;
  token: string;
  viewManager: ViewManagerService;
  typeIds: Map<string, string>;
  teardown(): Promise<void>;
}

export class TestScenarioBuilder {
  private types: ObjectTypeSpec[] = [];
  private instances = new Map<string, InstanceSpec[]>();
  private refreshViews = false;

  withObjectType(spec: ObjectTypeSpec): this {
    this.types.push(spec);
    return this;
  }

  withInstances(objectTypeName: string, instances: InstanceSpec[]): this {
    this.instances.set(objectTypeName, instances);
    this.refreshViews = true;
    return this;
  }

  async build(): Promise<BuiltScenario> {
    const app = await createTestApp();
    const prisma = new PrismaClient();
    const tenantId = await ensureTestTenant(app);
    const token = await loginAsTestTenantAdmin(app);
    const viewManager = app.get(ViewManagerService);
    const typeIds = new Map<string, string>();

    for (const spec of this.types) {
      await prisma.objectInstance.deleteMany({ where: { tenantId, objectType: spec.name } });
      const existing = await prisma.objectType.findFirst({ where: { tenantId, name: spec.name } });
      if (existing) await prisma.objectType.delete({ where: { id: existing.id } });
      await viewManager.drop(tenantId, spec.name).catch(() => {});
    }

    for (const spec of this.types) {
      const res = await request(app.getHttpServer())
        .post('/ontology/types')
        .set('Authorization', `Bearer ${token}`)
        .send(spec)
        .expect(201);
      typeIds.set(spec.name, res.body.id);
    }

    for (const [typeName, specs] of this.instances) {
      if (specs.length > 0) {
        await prisma.objectInstance.createMany({
          data: specs.map(s => ({
            tenantId,
            objectType: typeName,
            externalId: s.externalId,
            label: s.label ?? s.externalId,
            properties: s.properties as any,
            relationships: (s.relationships ?? {}) as any,
          })),
        });
      }
    }

    if (this.refreshViews) {
      for (const spec of this.types) {
        await viewManager.refresh(tenantId, spec.name);
      }
    }

    const teardown = async () => {
      for (const spec of this.types) {
        await prisma.objectInstance.deleteMany({ where: { tenantId, objectType: spec.name } });
        const existing = await prisma.objectType.findFirst({ where: { tenantId, name: spec.name } });
        if (existing) await prisma.objectType.delete({ where: { id: existing.id } });
        await viewManager.drop(tenantId, spec.name).catch(() => {});
      }
      await cleanupTestTenant(app);
      await prisma.$disconnect();
      await app.close();
    };

    return { app, prisma, tenantId, token, viewManager, typeIds, teardown };
  }
}
