import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { Prisma, PrismaService } from '@omaha/db';
import PgBoss from 'pg-boss';
import { PG_BOSS } from '../dataset/pg-boss.provider';
import { PIPELINE_RUN_QUEUE } from './pipeline-run.service';
import { TransformConfigService } from '../transform-config/transform-config.service';
import { DataPipelineOrchestrator } from './data-pipeline.orchestrator';

interface PipelineRunPayload { pipelineRunId: string; }

type Row = Record<string, unknown>;

/** Consumes pipeline-run queue, executes Pipeline steps in-memory, produces a clean Dataset (ADR-0045). */
@Injectable()
export class PipelineRunWorker implements OnModuleInit {
  private readonly logger = new Logger(PipelineRunWorker.name);

  constructor(
    @Inject(PG_BOSS) private readonly boss: PgBoss,
    private readonly prisma: PrismaService,
    private readonly transformConfigService: TransformConfigService,
    private readonly orchestrator: DataPipelineOrchestrator,
  ) {}

  async onModuleInit() {
    // pg-boss v10 requires a queue to exist before send()/work(). createQueue is an
    // idempotent upsert, so calling it on every boot is safe and keeps queue ownership
    // co-located with its worker.
    await this.boss.createQueue(PIPELINE_RUN_QUEUE);
    await this.boss.work<PipelineRunPayload>(PIPELINE_RUN_QUEUE, async (jobs) => {
      for (const job of jobs) {
        await this.handle(job);
      }
    });
  }

  private async handle(job: PgBoss.Job<PipelineRunPayload>) {
    const { pipelineRunId } = job.data;
    const run = await this.prisma.pipelineRun.findFirstOrThrow({ where: { id: pipelineRunId } });

    await this.prisma.pipelineRun.update({
      where: { id: pipelineRunId },
      data: { status: 'running' },
    });

    try {
      const [pipeline, steps] = await Promise.all([
        this.prisma.pipeline.findFirstOrThrow({ where: { id: run.pipelineId } }),
        this.prisma.pipelineStep.findMany({
          where: { pipelineId: run.pipelineId },
          orderBy: { order: 'asc' },
        }),
      ]);

      // Load input rows
      const rawRows = await this.prisma.datasetRow.findMany({
        where: { datasetId: run.inputDatasetId },
      });

      // 100k-row upper bound: in-memory execution risks OOM beyond this (Q11).
      if (rawRows.length > MAX_ROWS) {
        throw new StepError(
          -1,
          -1,
          `Input dataset has ${rawRows.length} rows, exceeding the ${MAX_ROWS}-row limit for in-memory pipeline execution`,
        );
      }

      let rows: Row[] = rawRows.map((r: { columns: unknown }) => r.columns as Row);

      // Execute steps in-memory sequentially, in `order`. Sort defensively so
      // execution order does not silently depend on the query's orderBy.
      const orderedSteps = [...steps].sort((a, b) => a.order - b.order);
      const configCache = new Map<string, { config: unknown }>();
      for (const step of orderedSteps) {
        rows = await this.executeStep(run.tenantId, step, rows, configCache);
      }

      // Determine clean Dataset version + get input dataset for connectorId (parallel)
      const cleanName = `${pipeline.name}_clean`;
      const [latestDataset, inputDataset] = await Promise.all([
        this.prisma.dataset.findFirst({
          where: { tenantId: run.tenantId, name: cleanName },
          orderBy: { version: 'desc' },
        }),
        this.prisma.dataset.findFirst({ where: { id: run.inputDatasetId } }),
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
        err instanceof StepError
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

  private async executeStep(
    tenantId: string,
    step: { order: number; type: string; config: unknown },
    rows: Row[],
    configCache: Map<string, { config: unknown }>,
  ): Promise<Row[]> {
    const config = step.config as Record<string, unknown>;
    switch (step.type) {
      case 'filter': {
        const field = config.field as string;
        const operator = config.operator as string;
        const target = config.value;
        return rows.filter((row, i) => {
          try {
            return matchesOperator(row[field], operator, target);
          } catch (e) {
            throw new StepError(step.order, i, e instanceof Error ? e.message : String(e));
          }
        });
      }
      case 'rename': {
        const mappings = config.mappings as Record<string, string>;
        return rows.map((row) => {
          const out: Row = {};
          for (const [key, value] of Object.entries(row)) {
            out[mappings[key] ?? key] = value;
          }
          return out;
        });
      }
      case 'compute':
        return this.executeCompute(tenantId, step, config, rows, configCache);
      default:
        throw new StepError(step.order, -1, `Unknown step type: ${step.type}`);
    }
  }

  /**
   * compute step: applies a predefined function (normalize_brand | price_band) using a
   * version-pinned TransformConfig (ADR-0054). The (configRef, configVersion) pin means a
   * Pipeline run is reproducible even after the config is later edited.
   */
  private async executeCompute(
    tenantId: string,
    step: { order: number },
    config: Record<string, unknown>,
    rows: Row[],
    configCache: Map<string, { config: unknown }>,
  ): Promise<Row[]> {
    const fn = config.function as string;
    const inputField = config.inputField as string;
    const outputField = config.outputField as string;
    const configRef = config.configRef as string;
    const configVersion = config.configVersion as number | undefined;

    // Cache by (configRef, version) within a run so multiple steps sharing a
    // config hit the DB once.
    const cacheKey = `${configRef}:${configVersion ?? 'latest'}`;
    let transformConfig = configCache.get(cacheKey);
    if (!transformConfig) {
      try {
        transformConfig = await this.transformConfigService.get(tenantId, configRef, configVersion);
      } catch (e) {
        // Missing config/version is a permanent error: retrying won't conjure the version.
        throw new StepError(step.order, -1, e instanceof Error ? e.message : String(e));
      }
      configCache.set(cacheKey, transformConfig);
    }
    const tcConfig = transformConfig.config as Record<string, unknown>;

    switch (fn) {
      case 'normalize_brand': {
        const mappings = (tcConfig.mappings ?? {}) as Record<string, string>;
        const caseSensitive = config.caseSensitive === true;
        // Build a lookup keyed by (optionally) lowercased source value.
        const lookup = new Map<string, string>();
        for (const [from, to] of Object.entries(mappings)) {
          lookup.set(caseSensitive ? from : from.toLowerCase(), to);
        }
        return rows.map((row) => {
          const raw = row[inputField];
          const key = caseSensitive ? String(raw) : String(raw).toLowerCase();
          const mapped = lookup.has(key) ? lookup.get(key)! : raw; // passthrough unknowns
          return { ...row, [outputField]: mapped };
        });
      }
      case 'price_band': {
        const bands = (tcConfig.bands ?? []) as Array<{ max?: number; label: string }>;
        return rows.map((row, i) => {
          const value = row[inputField];
          const num = typeof value === 'number' ? value : Number(value);
          if (Number.isNaN(num)) {
            throw new StepError(step.order, i, `price_band: non-numeric value in field "${inputField}": ${String(value)}`);
          }
          // Bands are ordered; the first band whose max >= value wins. A band without `max`
          // is the open-ended top band and matches anything remaining.
          const band = bands.find((b) => b.max === undefined || num <= b.max);
          if (!band) {
            throw new StepError(step.order, i, `price_band: value ${num} fell outside all configured bands`);
          }
          return { ...row, [outputField]: band.label };
        });
      }
      default:
        throw new StepError(step.order, -1, `Unknown compute function: ${fn}`);
    }
  }
}

const MAX_ROWS = 100_000;

/** Carries the failing step order + row index so PipelineRun.error can explain the break (Q15). */
class StepError extends Error {
  constructor(
    public readonly stepOrder: number,
    public readonly rowIndex: number,
    message: string,
  ) {
    super(message);
    this.name = 'StepError';
  }
}

function matchesOperator(left: unknown, operator: string, right: unknown): boolean {
  switch (operator) {
    case 'eq':
      return left === right;
    case 'gt':
      return (left as number) > (right as number);
    case 'lt':
      return (left as number) < (right as number);
    case 'gte':
      return (left as number) >= (right as number);
    case 'lte':
      return (left as number) <= (right as number);
    case 'contains':
      return String(left).includes(String(right));
    case 'in':
      return Array.isArray(right) && (right as unknown[]).includes(left);
    default:
      throw new Error(`Unsupported operator: ${operator}`);
  }
}
