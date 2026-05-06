import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, PrismaService } from '@omaha/db';
import {
  CreateObjectTypeRequest,
  UpdateObjectTypeRequest,
  CreateRelationshipRequest,
  PropertyDefinition,
  DerivedPropertyDefinition,
} from '@omaha/shared-types';
import { analyze } from '@omaha/dsl';
import { assertTenantOwnership } from '../../common/helpers/assert-tenant-ownership';
import { IndexManagerService } from './index-manager.service';

@Injectable()
export class OntologyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly indexManager: IndexManagerService,
  ) {}

  async listObjectTypes(tenantId: string) {
    return this.prisma.objectType.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
  }

  async getObjectType(tenantId: string, id: string) {
    const ot = await this.prisma.objectType.findUnique({ where: { id } });
    assertTenantOwnership(ot, tenantId, 'ObjectType');
    return ot;
  }

  async createObjectType(tenantId: string, dto: CreateObjectTypeRequest) {
    await this.validateDerivedProperties(tenantId, undefined, dto.properties, dto.derivedProperties ?? []);
    const created = await this.prisma.objectType.create({
      data: {
        tenantId,
        name: dto.name,
        label: dto.label,
        properties: dto.properties as unknown as Prisma.InputJsonValue,
        derivedProperties: (dto.derivedProperties ?? []) as unknown as Prisma.InputJsonValue,
      },
    });
    await this.indexManager.reconcile(tenantId, created.id);
    return created;
  }

  async updateObjectType(tenantId: string, id: string, dto: UpdateObjectTypeRequest) {
    const existing = await this.getObjectType(tenantId, id);
    const nextProps = dto.properties ?? ((existing!.properties ?? []) as unknown as PropertyDefinition[]);
    const nextDerived = dto.derivedProperties
      ?? ((existing!.derivedProperties ?? []) as unknown as DerivedPropertyDefinition[]);
    if (dto.properties !== undefined || dto.derivedProperties !== undefined) {
      await this.validateDerivedProperties(tenantId, id, nextProps, nextDerived);
    }
    const updated = await this.prisma.objectType.update({
      where: { id },
      data: {
        ...(dto.label !== undefined && { label: dto.label }),
        ...(dto.properties !== undefined && { properties: dto.properties as unknown as Prisma.InputJsonValue }),
        ...(dto.derivedProperties !== undefined && { derivedProperties: dto.derivedProperties as unknown as Prisma.InputJsonValue }),
        version: { increment: 1 },
      },
    });
    await this.indexManager.reconcile(tenantId, id);
    return updated;
  }

  async deleteObjectType(tenantId: string, id: string) {
    await this.getObjectType(tenantId, id);
    await this.indexManager.dropAllFor(tenantId, id);
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
    await this.getRelationship(tenantId, id);
    return this.prisma.objectRelationship.delete({ where: { id } });
  }

  private async getRelationship(tenantId: string, id: string) {
    const rel = await this.prisma.objectRelationship.findUnique({ where: { id } });
    assertTenantOwnership(rel, tenantId, 'Relationship');
    return rel;
  }

  private async validateDerivedProperties(
    tenantId: string,
    objectTypeId: string | undefined,
    properties: PropertyDefinition[],
    derived: DerivedPropertyDefinition[],
  ): Promise<void> {
    if (!derived.length) return;
    const knownProperties = new Set(properties.map((p) => p.name));
    const knownDerivedProperties = new Set(derived.map((d) => d.name));
    const knownRelations = objectTypeId
      ? await this.relationsForSource(tenantId, objectTypeId)
      : new Set<string>();

    const depsByName = new Map<string, string[]>();
    for (const d of derived) {
      const result = analyze(d.expression, { knownProperties, knownDerivedProperties, knownRelations });
      if (!result.valid) {
        throw new BadRequestException(
          `Derived property '${d.name}' has invalid expression: ${result.errors.join('; ')}`,
        );
      }
      depsByName.set(d.name, result.dependencies.filter((dep) => knownDerivedProperties.has(dep)));
    }

    const cycle = findCycle(depsByName);
    if (cycle) {
      throw new BadRequestException(
        `Derived property cycle detected: ${cycle.join(' -> ')}`,
      );
    }
  }

  private async relationsForSource(tenantId: string, sourceTypeId: string): Promise<Set<string>> {
    const rels = await this.prisma.objectRelationship.findMany({
      where: { tenantId, sourceTypeId },
      select: { name: true },
    });
    return new Set(rels.map((r) => r.name));
  }

  async validateDerivedExpression(tenantId: string, objectTypeId: string, expression: string) {
    const ot = await this.getObjectType(tenantId, objectTypeId);
    const properties = ((ot!.properties ?? []) as unknown as PropertyDefinition[]);
    const derived = ((ot!.derivedProperties ?? []) as unknown as DerivedPropertyDefinition[]);
    const knownProperties = new Set(properties.map((p) => p.name));
    const knownDerivedProperties = new Set(derived.map((d) => d.name));
    const knownRelations = await this.relationsForSource(tenantId, objectTypeId);
    return analyze(expression, { knownProperties, knownDerivedProperties, knownRelations });
  }
}

function findCycle(graph: Map<string, string[]>): string[] | null {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const k of graph.keys()) color.set(k, WHITE);

  const stack: string[] = [];

  function dfs(node: string): string[] | null {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (!graph.has(next)) continue;
      const c = color.get(next);
      if (c === GRAY) {
        const cycleStart = stack.indexOf(next);
        return [...stack.slice(cycleStart), next];
      }
      if (c === WHITE) {
        const found = dfs(next);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(node, BLACK);
    return null;
  }

  for (const node of graph.keys()) {
    if (color.get(node) === WHITE) {
      const found = dfs(node);
      if (found) return found;
    }
  }
  return null;
}
