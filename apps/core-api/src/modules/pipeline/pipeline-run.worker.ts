import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { Prisma, PrismaService } from '@omaha/db';
import PgBoss from 'pg-boss';
import { PG_BOSS, consumeQueue } from '../dataset/pg-boss.provider';
import { PIPELINE_RUN_QUEUE } from './pipeline-run.service';
import { TransformConfigService } from '../transform-config/transform-config.service';
import { DataPipelineOrchestrator } from './data-pipeline.orchestrator';
import { TransformEngine, TransformStepError, StepConfig, Row } from './transform-engine';

interface PipelineRunPayload { pipelineRunId: string; }

/**
 * Consumes the pipeline-run queue and produces a clean Dataset (ADR-0045). Transform execution is
 * delegated to {@link TransformEngine} (ADR-0060 #1, DuckDB) — this worker owns only the I/O around
 * it: loading the input rows, resolving version-pinned TransformConfigs for compute steps (ADR-0054)
 * and inlining them into step config, persisting the clean Dataset, and continuing the reactive chain.
 */
@Injectable()
export class PipelineRunWorker implements OnModuleInit {
  private readonly logger = new Logger(PipelineRunWorker.name);
  private readonly engine = new TransformEngine();

  constructor(
    @Inject(PG_BOSS) private readonly boss: PgBoss,
    private readonly prisma: PrismaService,
    private readonly transformConfigService: TransformConfigService,
    private readonly orchestrator: DataPipelineOrchestrator,
  ) {}

  async onModuleInit() {
    await consumeQueue<PipelineRunPayload>(this.boss, PIPELINE_RUN_QUEUE, (job) => this.handle(job));
  }

  private async handle(job: PgBoss.Job<PipelineRunPayload>) {
    const { pipelineRunId } = job.data;
    const run = await this.prisma.pipelineRun.findFirstOrThrow({ where: { id: pipelineRunId } });

    await this.prisma.pipelineRun.update({
      where: { id: pipelineRunId },
      data: { status: 'running' },
    });

    try {
      const [pipeline, steps, runInputs] = await Promise.all([
        this.prisma.pipeline.findFirstOrThrow({ where: { id: run.pipelineId } }),
        this.prisma.pipelineStep.findMany({
          where: { pipelineId: run.pipelineId },
          orderBy: { order: 'asc' },
        }),
        this.prisma.pipelineRunInput.findMany({
          where: { pipelineRunId: pipelineRunId },
          orderBy: { createdAt: 'asc' },
        }),
      ]);

      // v1 executes a single input (multi-input join lands in #184). The input set is guaranteed
      // non-empty by enqueue(); take the first declared input.
      const primaryInput = runInputs[0];
      if (!primaryInput) throw new TransformStepError(-1, -1, `PipelineRun ${pipelineRunId} has no input datasets`);
      const inputDatasetId = primaryInput.datasetId;

      // Load input rows
      const rawRows = await this.prisma.datasetRow.findMany({
        where: { datasetId: inputDatasetId },
      });

      // DuckDB's columnar engine handles real volume, but a runaway input still warrants a loud,
      // structured failure rather than an OOM. The bound is far above the former in-memory 100k cap.
      if (rawRows.length > MAX_ROWS) {
        throw new TransformStepError(
          -1,
          -1,
          `Input dataset has ${rawRows.length} rows, exceeding the ${MAX_ROWS}-row single-node limit`,
        );
      }

      const inputRows: Row[] = rawRows.map((r: { columns: unknown }) => r.columns as Row);

      // Resolve any version-pinned TransformConfig (ADR-0054) and inline the result into compute
      // steps, so the engine stays a pure function of (rows, steps) with no DB coupling.
      const resolvedSteps = await this.resolveSteps(run.tenantId, steps);
      const rows = await this.engine.run([{ name: 'input', rows: inputRows }], resolvedSteps);

      // Determine clean Dataset version + get input dataset for connectorId (parallel)
      const cleanName = `${pipeline.name}_clean`;
      const [latestDataset, inputDataset] = await Promise.all([
        this.prisma.dataset.findFirst({
          where: { tenantId: run.tenantId, name: cleanName },
          orderBy: { version: 'desc' },
        }),
        this.prisma.dataset.findFirst({ where: { id: inputDatasetId } }),
      ]);
      const nextVersion = (latestDataset?.version ?? 0) + 1;

      // Create clean Dataset
      const cleanDataset = await this.prisma.dataset.create({
        data: {
          tenantId: run.tenantId,
          name: cleanName,
          connectorId: inputDataset!.connectorId,
          kind: 'clean',
          status: 'ready',
          version: nextVersion,
          rowCount: rows.length,
        },
      });

      // Write rows
      if (rows.length > 0) {
        await this.prisma.datasetRow.createMany({
          data: rows.map((columns, i) => ({
            tenantId: run.tenantId,
            datasetId: cleanDataset.id,
            rowIndex: i,
            columns: columns as Prisma.InputJsonValue,
          })),
        });
      }

      // Mark success
      await this.prisma.pipelineRun.update({
        where: { id: pipelineRunId },
        data: {
          status: 'success',
          outputDatasetId: cleanDataset.id,
          recordsProcessed: rows.length,
          completedAt: new Date(),
        },
      });

      // Trigger the next reactive step: clean Dataset → SyncJob (ADR-0045 §2).
      // Fire-and-forget: pg-boss handles retries if the orchestrator enqueue transiently fails.
      void this.orchestrator.onPipelineRunComplete(run.tenantId, pipelineRunId).catch((err) => {
        this.logger.error(`onPipelineRunComplete failed for run=${pipelineRunId}`, err);
      });
    } catch (err: unknown) {
      this.logger.error(`PipelineRun ${pipelineRunId} failed`, err);
      const detail =
        err instanceof TransformStepError
          ? { step: err.stepOrder, rowIndex: err.rowIndex, message: err.message }
          : { message: err instanceof Error ? err.message : String(err) };
      await this.prisma.pipelineRun.update({
        where: { id: pipelineRunId },
        data: {
          status: 'failed',
          error: detail,
          completedAt: new Date(),
        },
      });
      throw err;
    }
  }

  /**
   * Enrich each step with anything that must be fetched from the DB before the (pure) engine runs.
   * Today that is only compute steps: their predefined function needs the version-pinned
   * TransformConfig's lookup tables (normalize_brand → mappings, price_band → bands) inlined so the
   * engine never reaches back into TransformConfigService. A missing (configRef, version) is a
   * permanent error — retrying won't conjure the version (ADR-0054).
   */
  private async resolveSteps(
    tenantId: string,
    steps: Array<{ order: number; type: string; config: unknown }>,
  ): Promise<StepConfig[]> {
    // Cache by (configRef, version) within a run so multiple steps sharing a config hit the DB once.
    const configCache = new Map<string, Record<string, unknown>>();
    const ordered = [...steps].sort((a, b) => a.order - b.order);
    const resolved: StepConfig[] = [];
    for (const step of ordered) {
      const config = (step.config ?? {}) as Record<string, unknown>;
      // Only compute steps that REFERENCE an external config need resolution. Self-contained
      // compute functions (e.g. `concat`, #177) carry their full config inline and pass through
      // untouched — resolving an absent configRef would throw a spurious "config not found".
      if (step.type !== 'compute' || config.configRef === undefined) {
        resolved.push({ order: step.order, type: step.type, config });
        continue;
      }
      const configRef = config.configRef as string;
      const configVersion = config.configVersion as number | undefined;
      const cacheKey = `${configRef}:${configVersion ?? 'latest'}`;
      let tcConfig = configCache.get(cacheKey);
      if (!tcConfig) {
        try {
          const tc = await this.transformConfigService.get(tenantId, configRef, configVersion);
          tcConfig = tc.config as Record<string, unknown>;
        } catch (e) {
          throw new TransformStepError(step.order, -1, e instanceof Error ? e.message : String(e));
        }
        configCache.set(cacheKey, tcConfig);
      }
      // Inline the resolved lookup tables alongside the step's own (function/fields/caseSensitive).
      resolved.push({
        order: step.order,
        type: 'compute',
        config: { ...config, mappings: tcConfig.mappings ?? {}, bands: tcConfig.bands ?? [] },
      });
    }
    return resolved;
  }
}

// Single-node sanity ceiling for DuckDB execution. Far above the former 100k in-memory cap; exists
// only to convert a pathological input into a structured failure instead of an OOM.
export const MAX_ROWS = 20_000_000;
