import { Injectable } from '@nestjs/common';
import { Prisma, PrismaService } from '@omaha/db';
import { CreateConnectorRequest, UpdateConnectorRequest } from '@omaha/shared-types';
import { assertTenantOwnership } from '../../common/helpers/assert-tenant-ownership';

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
    assertTenantOwnership(conn, tenantId, 'Connector');
    return conn;
  }

  async createConnector(tenantId: string, dto: CreateConnectorRequest) {
    return this.prisma.connector.create({
      data: {
        tenantId,
        name: dto.name,
        type: dto.type,
        config: dto.config as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async updateConnector(tenantId: string, id: string, dto: UpdateConnectorRequest) {
    await this.getConnector(tenantId, id);
    return this.prisma.connector.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.config !== undefined && { config: dto.config as unknown as Prisma.InputJsonValue }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
  }

  async deleteConnector(tenantId: string, id: string) {
    await this.getConnector(tenantId, id);
    return this.prisma.connector.delete({ where: { id } });
  }
}
