import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService, PipelineRun } from '@omaha/db';
import PgBoss from 'pg-boss';
import { PG_BOSS } from '../dataset/pg-boss.provider';

export const PIPELINE_RUN_QUEUE = 'pipeline-run';

@Injectable()
export class PipelineRunService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PG_BOSS) private readonly boss: PgBoss,
  ) {}

  async enqueue(tenantId: string, pipelineId: string, inputDatasetId: string): Promise<PipelineRun> {
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.pipelineRun.create({
        data: { tenantId, pipelineId, inputDatasetId, status: 'pending' },
      });
      const pgBossJobId = await this.boss.send(PIPELINE_RUN_QUEUE, { pipelineRunId: run.id }, {
        retryLimit: 1,
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: 3600,
      });
      return tx.pipelineRun.update({ where: { id: run.id }, data: { pgBossJobId } });
    });
  }

  async getRun(tenantId: string, id: string): Promise<PipelineRun> {
    const run = await this.prisma.pipelineRun.findFirst({ where: { tenantId, id } });
    if (!run) throw new NotFoundException(`PipelineRun ${id} not found`);
    return run;
  }

  listRuns(tenantId: string, pipelineId?: string): Promise<PipelineRun[]> {
    return this.prisma.pipelineRun.findMany({
      where: { tenantId, ...(pipelineId ? { pipelineId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }
}
