import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { Prisma, PrismaService } from '@omaha/db';
import PgBoss from 'pg-boss';
import { PG_BOSS } from '../dataset/pg-boss.provider';
import { PIPELINE_RUN_QUEUE } from './pipeline-run.service';

interface PipelineRunPayload { pipelineRunId: string; }

type Row = Record<string, unknown>;

/** Consumes pipeline-run queue, executes Pipeline steps in-memory, produces a clean Dataset (ADR-0045). */
@Injectable()
export class PipelineRunWorker implements OnModuleInit {
  private readonly logger = new Logger(PipelineRunWorker.name);

  constructor(
    @Inject(PG_BOSS) private readonly boss: PgBoss,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
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
      let rows: Row[] = rawRows.map((r: { columns: unknown }) => r.columns as Row);

      // Execute steps in-memory sequentially
      for (const step of steps) {
        rows = this.executeStep(step, rows);
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
    } catch (err: unknown) {
      this.logger.error(`PipelineRun ${pipelineRunId} failed`, err);
      await this.prisma.pipelineRun.update({
        where: { id: pipelineRunId },
        data: {
          status: 'failed',
          error: { message: err instanceof Error ? err.message : String(err) },
          completedAt: new Date(),
        },
      });
      throw err;
    }
  }

  private executeStep(step: { type: string; config: unknown }, rows: Row[]): Row[] {
    const config = step.config as Record<string, unknown>;
    switch (step.type) {
      case 'filter':
        return rows.filter((row) => row[config.column as string] === config.value);
      case 'rename': {
        const from = config.from as string;
        const to = config.to as string;
        return rows.map((row) => {
          const { [from]: val, ...rest } = row;
          return { ...rest, [to]: val };
        });
      }
      case 'compute': {
        const field = config.field as string;
        const expression = config.expression as string;
        return rows.map((row) => ({ ...row, [field]: expression }));
      }
      default:
        return rows;
    }
  }
}
