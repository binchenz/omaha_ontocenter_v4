import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaService } from '@omaha/db';

export interface CreatePipelineDto {
  name: string;
  connectorId: string;
  outputObjectTypeId: string;
}

export interface AddStepDto {
  order: number;
  type: string;
  config: Record<string, unknown>;
  name?: string;
}

@Injectable()
export class PipelineService {
  constructor(private readonly prisma: PrismaService) {}

  listPipelines(tenantId: string) {
    return this.prisma.pipeline.findMany({ where: { tenantId } });
  }

  async getPipeline(tenantId: string, id: string) {
    const p = await this.prisma.pipeline.findFirst({ where: { tenantId, id } });
    if (!p) throw new NotFoundException(`Pipeline ${id} not found`);
    return p;
  }

  async createPipeline(tenantId: string, dto: CreatePipelineDto) {
    return this.prisma.pipeline.create({
      data: {
        tenantId,
        name: dto.name,
        connectorId: dto.connectorId,
        outputObjectTypeId: dto.outputObjectTypeId,
      },
    });
  }

  async updatePipeline(tenantId: string, id: string, data: Partial<Pick<CreatePipelineDto, 'name' | 'connectorId' | 'outputObjectTypeId'>> & { status?: string }) {
    await this.getPipeline(tenantId, id);
    return this.prisma.pipeline.update({ where: { id }, data });
  }

  async deletePipeline(tenantId: string, id: string) {
    await this.getPipeline(tenantId, id);
    return this.prisma.pipeline.delete({ where: { id } });
  }

  async addStep(tenantId: string, pipelineId: string, dto: AddStepDto) {
    await this.getPipeline(tenantId, pipelineId);
    return this.prisma.pipelineStep.create({
      data: {
        pipelineId,
        order: dto.order,
        type: dto.type,
        config: dto.config as Prisma.InputJsonValue,
        name: dto.name,
      },
    });
  }

  async removeStep(tenantId: string, pipelineId: string, stepId: string) {
    await this.getPipeline(tenantId, pipelineId);
    return this.prisma.pipelineStep.delete({ where: { id: stepId } });
  }

  async listSteps(tenantId: string, pipelineId: string) {
    await this.getPipeline(tenantId, pipelineId);
    return this.prisma.pipelineStep.findMany({
      where: { pipelineId },
      orderBy: { order: 'asc' },
    });
  }
}
