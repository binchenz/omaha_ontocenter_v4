import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Prisma, PrismaService } from '@omaha/db';

export interface CreateDatasetDto {
  name: string;
  connectorId: string;
  kind?: 'raw' | 'clean';
  /** Batch-alignment key value for this snapshot (e.g. "25.06" for reportMonth), #186. */
  alignKeyValue?: string;
}

/**
 * Reactive trigger seam (#168). DatasetService fires this when a `raw` Dataset
 * becomes ready. Typed structurally (not by import) to avoid a hard module cycle
 * — the concrete DataPipelineOrchestrator is wired via DATASET_PIPELINE_TRIGGER.
 */
export interface RawDatasetReadyTrigger {
  onRawDatasetReady(tenantId: string, datasetId: string): Promise<void>;
}

export const DATASET_PIPELINE_TRIGGER = 'DATASET_PIPELINE_TRIGGER';

@Injectable()
export class DatasetService {
  private readonly logger = new Logger(DatasetService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(DATASET_PIPELINE_TRIGGER)
    private readonly pipelineTrigger?: RawDatasetReadyTrigger,
  ) {}

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
      data: {
        tenantId,
        name: dto.name,
        connectorId: dto.connectorId,
        kind: dto.kind ?? 'clean',
        alignKeyValue: dto.alignKeyValue ?? null,
      },
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
    const updated = await this.prisma.dataset.update({
      where: { id: datasetId },
      data: { status: 'ready' },
    });

    // Reactive trigger (#168): only raw Datasets kick off PipelineRuns. Clean
    // Datasets are handled by the orchestrator's own post-PipelineRun SyncJob path.
    if (updated.kind === 'raw' && this.pipelineTrigger) {
      // Fire-and-forget: don't await — the caller returns as soon as the status
      // flips. A trigger failure is logged but must not block or roll back `ready`.
      void this.pipelineTrigger.onRawDatasetReady(tenantId, datasetId).catch((err) => {
        this.logger.error(
          `onRawDatasetReady failed for dataset=${datasetId} (status stays ready)`,
          err instanceof Error ? err.stack : String(err),
        );
      });
    }

    return updated;
  }
}
