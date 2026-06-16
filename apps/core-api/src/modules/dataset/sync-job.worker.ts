import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import PgBoss from 'pg-boss';
import { PG_BOSS, consumeQueue } from './pg-boss.provider';
import { SYNC_JOB_QUEUE } from './sync-job.service';
import { ImportEngine } from '../agent/sdk/import-engine.service';

interface SyncJobPayload { syncJobId: string; }

/** Consumes sync-job queue, maps Dataset rows via ObjectMapping, upserts via ImportEngine (ADR-0040 §1). */
@Injectable()
export class SyncJobWorker implements OnModuleInit {
  private readonly logger = new Logger(SyncJobWorker.name);

  constructor(
    @Inject(PG_BOSS) private readonly boss: PgBoss,
    private readonly prisma: PrismaService,
    private readonly importEngine: ImportEngine,
  ) {}

  async onModuleInit() {
    await consumeQueue<SyncJobPayload>(this.boss, SYNC_JOB_QUEUE, (job) => this.handle(job));
  }

  private async handle(job: PgBoss.Job<SyncJobPayload>) {
    const { syncJobId } = job.data;
    const syncJob = await this.prisma.syncJob.findFirstOrThrow({ where: { id: syncJobId } });
    const { tenantId, datasetId } = syncJob;

    await this.prisma.syncJob.update({
      where: { id: syncJobId },
      data: { status: 'running', startedAt: new Date() },
    });
    try {
      // Guard: only clean Datasets may be synced to object_instances (ADR-0045)
      const dataset = await this.prisma.dataset.findFirst({ where: { tenantId, id: datasetId! } });
      if (!dataset || dataset.kind !== 'clean') {
        throw new Error(`cannot sync raw Dataset — Pipeline required (datasetId=${datasetId})`);
      }
      const mapping = await this.prisma.objectMapping.findFirstOrThrow({
        where: { id: syncJob.mappingId! },
      });
      const [rows, objectType] = await Promise.all([
        this.prisma.datasetRow.findMany({ where: { tenantId, datasetId: datasetId! } }),
        this.prisma.objectType.findFirstOrThrow({ where: { id: mapping.objectTypeId } }),
      ]);
      const propMap = (mapping.propertyMappings as Record<string, string>) ?? {};
      const instances = rows.map((r: { columns: unknown; rowIndex: number }) => {
        const cols = r.columns as Record<string, unknown>;
        const properties: Record<string, unknown> = {};
        for (const [prop, col] of Object.entries(propMap)) {
          if (col in cols) properties[prop] = cols[col];
        }
        const externalId = String(cols['externalId'] ?? cols['external_id'] ?? `row_${r.rowIndex}`);
        return { externalId, label: externalId, properties };
      });
      const result = await this.importEngine.importInstances(tenantId, objectType.name, instances);
      await this.completeSyncJob(syncJobId, 'success', { recordsProcessed: result.imported });
    } catch (err: unknown) {
      if (this.isPermanentError(err)) {
        this.logger.error(`SyncJob ${syncJobId} permanently failed`, err);
        await this.completeSyncJob(syncJobId, 'failed', {
          errorLog: { type: 'permanent', message: err instanceof Error ? err.message : String(err) },
        });
        // Do NOT rethrow — pg-boss will not retry permanent failures
        return;
      }
      // Transient error — rethrow so pg-boss retries with backoff
      this.logger.error(`SyncJob ${syncJobId} failed (transient, will retry)`, err);
      await this.completeSyncJob(syncJobId, 'failed', {
        errorLog: { type: 'transient', message: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  }

  private completeSyncJob(id: string, status: string, extra: Record<string, unknown> = {}) {
    return this.prisma.syncJob.update({
      where: { id },
      data: { status, completedAt: new Date(), ...extra },
    });
  }

  /** Classify errors: validation, not-found, schema → permanent (no retry). Everything else → transient. */
  private isPermanentError(err: unknown): boolean {
    if (err instanceof Error) {
      // NotFoundException from Prisma/NestJS
      if (err.name === 'NotFoundException' || err.name === 'NotFoundError') return true;
      // Validation errors from ImportEngine
      if (err.name === 'ValidationError') return true;
      if (err.message.includes('allowedValues')) return true;
      // Kind guard (ADR-0045)
      if (err.message.includes('cannot sync raw Dataset')) return true;
      // Prisma record-not-found (specific patterns only)
      if (err.name === 'NotFoundError' || err.message.startsWith('No ') || err.message.includes('Record to update not found')) return true;
    }
    return false;
  }
}
