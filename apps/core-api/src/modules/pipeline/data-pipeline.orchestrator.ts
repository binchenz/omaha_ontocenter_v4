import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { PipelineRunService } from './pipeline-run.service';
import { SyncJobService } from '../dataset/sync-job.service';
import { resolveInputAlignment, ReadyVersion } from './input-alignment-resolver';

/** One declared input source of a Pipeline: the role name a `join` references + its source Connector. */
interface DeclaredInput {
  inputName: string;
  connectorId: string;
}

/** Reactive trigger chain: raw Dataset ready → PipelineRun(s) → clean Dataset → SyncJob (ADR-0045). */
@Injectable()
export class DataPipelineOrchestrator {
  private readonly logger = new Logger(DataPipelineOrchestrator.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pipelineRunService: PipelineRunService,
    private readonly syncJobService: SyncJobService,
  ) {}

  /**
   * Called when a raw Dataset is marked ready. For each active Pipeline that consumes its Connector,
   * runs the model-1′ join-barrier (ADR-0060 #5, #186): a run is enqueued only when
   * InputAlignmentResolver says every *declared* input is satisfied, and only with the input
   * versions it chose.
   *
   * A Pipeline's declared inputs come from its PipelineInput rows; a Pipeline with none implicitly
   * declares a single input — its own Connector — so single-input AVC fires immediately on the one
   * ready Dataset (no regression). Multi-input (fact×fact) Pipelines wait at the barrier until every
   * declared input has a ready version (and, with alignKey, a *same-key* version).
   */
  async onRawDatasetReady(tenantId: string, datasetId: string): Promise<void> {
    const dataset = await this.prisma.dataset.findFirst({ where: { id: datasetId } });
    if (!dataset) return;

    const affected = await this.pipelinesConsuming(tenantId, dataset.connectorId);
    for (const { pipeline, declaredInputs } of affected) {
      // Gather the ready raw-Dataset versions for every declared input, keyed by input name, so the
      // resolver can apply the all-ready gate and (with alignKey) same-key selection.
      const readyVersionsByInput: Record<string, ReadyVersion[]> = Object.fromEntries(
        await Promise.all(
          declaredInputs.map(async (input): Promise<[string, ReadyVersion[]]> => [
            input.inputName,
            await this.readyVersionsFor(tenantId, input.connectorId),
          ]),
        ),
      );

      const { fire, chosenVersions } = resolveInputAlignment(
        declaredInputs.map((i) => i.inputName),
        readyVersionsByInput,
        pipeline.alignKey ?? undefined,
      );
      if (!fire) {
        this.logger.log(`Join-barrier holds pipeline=${pipeline.id}: declared inputs not yet aligned`);
        continue;
      }

      const inputDatasetIds = declaredInputs.map((i) => chosenVersions[i.inputName]);
      this.logger.log(`Enqueuing PipelineRun for pipeline=${pipeline.id} inputs=[${inputDatasetIds.join(', ')}]`);
      await this.pipelineRunService.enqueue(tenantId, pipeline.id, inputDatasetIds);
    }
  }

  /**
   * Active Pipelines that consume the given Connector, each paired with its declared input set.
   * Declared inputs come from PipelineInput rows; a Pipeline with none falls back to a single
   * implicit input named after its own Connector (the legacy single-input shape).
   */
  private async pipelinesConsuming(
    tenantId: string,
    connectorId: string,
  ): Promise<Array<{ pipeline: { id: string; connectorId: string; alignKey: string | null }; declaredInputs: DeclaredInput[] }>> {
    // A Pipeline is affected if its own Connector is the source (implicit single input) OR one of
    // its PipelineInput rows names this Connector — one OR query, no dedup needed.
    const pipelines = await this.prisma.pipeline.findMany({
      where: {
        tenantId,
        status: 'active',
        OR: [{ connectorId }, { inputs: { some: { connectorId } } }],
      },
    });

    return Promise.all(
      pipelines.map(async (pipeline) => ({
        pipeline,
        declaredInputs: await this.declaredInputsFor(pipeline),
      })),
    );
  }

  /** A Pipeline's declared inputs, falling back to the implicit single Connector input. */
  private async declaredInputsFor(
    pipeline: { id: string; connectorId: string },
  ): Promise<DeclaredInput[]> {
    const rows = await this.prisma.pipelineInput.findMany({ where: { pipelineId: pipeline.id } });
    if (rows.length > 0) {
      return rows.map((r: { inputName: string; connectorId: string }) => ({ inputName: r.inputName, connectorId: r.connectorId }));
    }
    return [{ inputName: pipeline.connectorId, connectorId: pipeline.connectorId }];
  }

  /** Ready raw-Dataset versions for one input Connector, oldest→newest (resolver picks the latest). */
  private async readyVersionsFor(tenantId: string, connectorId: string): Promise<ReadyVersion[]> {
    const datasets = await this.prisma.dataset.findMany({
      where: { tenantId, connectorId, kind: 'raw', status: 'ready' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, alignKeyValue: true },
    });
    return datasets.map((d: { id: string; alignKeyValue: string | null }) => ({
      datasetId: d.id,
      alignKeyValue: d.alignKeyValue ?? undefined,
    }));
  }

  /** Called when a PipelineRun completes successfully. Finds the Mapping and enqueues a SyncJob. */
  async onPipelineRunComplete(tenantId: string, pipelineRunId: string): Promise<void> {
    const run = await this.prisma.pipelineRun.findFirstOrThrow({ where: { id: pipelineRunId } });
    const pipeline = await this.prisma.pipeline.findFirstOrThrow({ where: { id: run.pipelineId } });

    const mapping = await this.prisma.objectMapping.findFirst({
      where: {
        tenantId,
        connectorId: pipeline.connectorId,
        objectTypeId: pipeline.outputObjectTypeId
      },
    });

    if (!mapping) {
      this.logger.warn(`No Mapping for objectType=${pipeline.outputObjectTypeId}, skipping SyncJob`);
      return;
    }

    this.logger.log(`Enqueuing SyncJob for dataset=${run.outputDatasetId} mapping=${mapping.id}`);
    await this.syncJobService.enqueue(tenantId, run.outputDatasetId!, mapping.id);
  }
}
