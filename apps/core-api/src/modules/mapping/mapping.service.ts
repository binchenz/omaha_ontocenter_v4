import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaService } from '@omaha/db';
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
        propertyMappings: dto.propertyMappings as unknown as Prisma.InputJsonValue,
        relationshipMappings: (dto.relationshipMappings ?? {}) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async deleteMapping(tenantId: string, id: string) {
    await this.getMapping(tenantId, id);
    return this.prisma.objectMapping.delete({ where: { id } });
  }
}
