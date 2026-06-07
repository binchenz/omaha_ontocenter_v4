import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { PipelineRunService } from './pipeline-run.service';
import { SyncJobService } from '../dataset/sync-job.service';

/** Reactive trigger chain: raw Dataset ready → PipelineRun(s) → clean Dataset → SyncJob (ADR-0045). */
@Injectable()
export class DataPipelineOrchestrator {
  private readonly logger = new Logger(DataPipelineOrchestrator.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pipelineRunService: PipelineRunService,
    private readonly syncJobService: SyncJobService,
  ) {}

  /** Called when a raw Dataset is marked ready. Finds all active Pipelines for its Connector and enqueues a PipelineRun for each. */
  async onRawDatasetReady(tenantId: string, datasetId: string): Promise<void> {
    const dataset = await this.prisma.dataset.findFirst({ where: { id: datasetId } });
    if (!dataset) return;

    const pipelines = await this.prisma.pipeline.findMany({
      where: { tenantId, connectorId: dataset.connectorId, status: 'active' },
    });

    for (const pipeline of pipelines) {
      this.logger.log(`Enqueuing PipelineRun for pipeline=${pipeline.id} dataset=${datasetId}`);
      await this.pipelineRunService.enqueue(tenantId, pipeline.id, datasetId);
    }
  }

  /** Called when a PipelineRun completes successfully. Finds the Mapping and enqueues a SyncJob. */
  async onPipelineRunComplete(tenantId: string, pipelineRunId: string): Promise<void> {
    const run = await this.prisma.pipelineRun.findFirstOrThrow({ where: { id: pipelineRunId } });
    const pipeline = await this.prisma.pipeline.findFirstOrThrow({ where: { id: run.pipelineId } });

    const mapping = await this.prisma.objectMapping.findFirst({
      where: { tenantId, objectTypeId: pipeline.outputObjectTypeId },
    });

    if (!mapping) {
      this.logger.warn(`No Mapping for objectType=${pipeline.outputObjectTypeId}, skipping SyncJob`);
      return;
    }

    this.logger.log(`Enqueuing SyncJob for dataset=${run.outputDatasetId} mapping=${mapping.id}`);
    await this.syncJobService.enqueue(tenantId, run.outputDatasetId!, mapping.id);
  }
}
