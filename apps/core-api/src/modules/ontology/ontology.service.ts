import { Injectable } from '@nestjs/common';
import { Prisma, PrismaService } from '@omaha/db';
import { CreateObjectTypeRequest, UpdateObjectTypeRequest, CreateRelationshipRequest } from '@omaha/shared-types';
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
    await this.getObjectType(tenantId, id);
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
}
