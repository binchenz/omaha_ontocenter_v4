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

  /**
   * Enqueue a PipelineRun over one or more input Datasets (ADR-0060 #3). A single id is the common
   * AVC case (one-element input set); an array is the fact×fact multi-input case. The run record and
   * its input set are written in the same transaction as the pg-boss enqueue, so a committed run is
   * always both fully-described and queued.
   */
  async enqueue(tenantId: string, pipelineId: string, input: string | string[]): Promise<PipelineRun> {
    const datasetIds = Array.isArray(input) ? input : [input];
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.pipelineRun.create({
        data: { tenantId, pipelineId, status: 'pending' },
      });
      await tx.pipelineRunInput.createMany({
        data: datasetIds.map((datasetId) => ({ pipelineRunId: run.id, tenantId, datasetId })),
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
