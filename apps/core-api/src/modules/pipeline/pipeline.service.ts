import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaService } from '@omaha/db';
import { validatePipelineStep } from './pipeline-step.schemas';
import { TransformConfigService } from '../transform-config/transform-config.service';

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

export interface ConfigureStepDto {
  order: number;
  type: string;
  config: Record<string, unknown>;
  name?: string;
}

export interface ConfigurePipelineDto {
  name: string;
  connectorId: string;
  outputObjectTypeId: string;
  steps: ConfigureStepDto[];
  autoActivate?: boolean;
}

@Injectable()
export class PipelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transformConfigService: TransformConfigService,
  ) {}

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

  /**
   * High-level atomic create: Pipeline + all ordered Steps in one transaction (#172, Q6/Q10 design Y).
   * Validation and configRef→version pinning happen BEFORE any write, so a partial failure
   * persists nothing. compute steps carrying a configRef without configVersion are pinned to the
   * current latest version at configure time (ADR-0054), freezing the rule the Pipeline runs against.
   * MVP is create-only; there is no update path.
   */
  async configurePipeline(
    tenantId: string,
    dto: ConfigurePipelineDto,
  ): Promise<{ pipelineId: string; status: string }> {
    // 1. Validate every step config + resolve configRef pins up front (no writes yet).
    const prepared = await Promise.all(
      dto.steps.map(async (step) => {
        let config = validatePipelineStep(step.type, step.config);
        if (step.type === 'compute') {
          config = await this.pinComputeVersion(tenantId, config as Record<string, unknown>);
        }
        return { order: step.order, type: step.type, name: step.name, config };
      }),
    );

    const status = dto.autoActivate === false ? 'draft' : 'active';

    // 2. Persist atomically.
    return this.prisma.$transaction(async (tx) => {
      const pipeline = await tx.pipeline.create({
        data: {
          tenantId,
          name: dto.name,
          connectorId: dto.connectorId,
          outputObjectTypeId: dto.outputObjectTypeId,
          status,
        },
      });
      for (const step of prepared) {
        await tx.pipelineStep.create({
          data: {
            pipelineId: pipeline.id,
            order: step.order,
            type: step.type,
            name: step.name,
            config: step.config as Prisma.InputJsonValue,
          },
        });
      }
      return { pipelineId: pipeline.id, status };
    });
  }

  /** Pins a compute step's configRef to the current latest version when no explicit version is given (ADR-0054). */
  private async pinComputeVersion(
    tenantId: string,
    config: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const configRef = config.configRef as string | undefined;
    if (!configRef || config.configVersion !== undefined) {
      return config;
    }
    const latest = await this.transformConfigService.get(tenantId, configRef);
    return { ...config, configVersion: latest.version };
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
    const config = validatePipelineStep(dto.type, dto.config);
    return this.prisma.pipelineStep.create({
      data: {
        pipelineId,
        order: dto.order,
        type: dto.type,
        config: config as Prisma.InputJsonValue,
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
