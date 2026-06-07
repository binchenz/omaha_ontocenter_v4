import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaService } from '@omaha/db';

export interface CreateDatasetDto {
  name: string;
  connectorId: string;
  kind?: 'raw' | 'clean';
}

@Injectable()
export class DatasetService {
  constructor(private readonly prisma: PrismaService) {}

  listDatasets(tenantId: string) {
    return this.prisma.dataset.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
  }

  async getDataset(tenantId: string, id: string) {
    const d = await this.prisma.dataset.findFirst({ where: { tenantId, id } });
    if (!d) throw new NotFoundException(`Dataset ${id} not found`);
    return d;
  }

  async createDataset(tenantId: string, dto: CreateDatasetDto) {
    return this.prisma.dataset.create({
      data: { tenantId, name: dto.name, connectorId: dto.connectorId, kind: dto.kind ?? 'clean' },
    });
  }

  async appendRows(tenantId: string, datasetId: string, rows: Record<string, unknown>[]) {
    const dataset = await this.getDataset(tenantId, datasetId);
    const base = dataset.rowCount;
    await this.prisma.$transaction(async (tx) => {
      await tx.datasetRow.createMany({
        data: rows.map((columns, i) => ({
          tenantId,
          datasetId,
          rowIndex: base + i,
          columns: columns as Prisma.InputJsonValue,
        })),
      });
      await tx.dataset.update({ where: { id: datasetId }, data: { rowCount: { increment: rows.length } } });
    });
  }

  async markReady(tenantId: string, datasetId: string) {
    await this.getDataset(tenantId, datasetId);
    return this.prisma.dataset.update({ where: { id: datasetId }, data: { status: 'ready' } });
  }
}
