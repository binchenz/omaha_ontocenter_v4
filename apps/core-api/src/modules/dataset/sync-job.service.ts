import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService, SyncJob } from '@omaha/db';
import PgBoss from 'pg-boss';
import { PG_BOSS } from './pg-boss.provider';

export const SYNC_JOB_QUEUE = 'sync-job';

@Injectable()
export class SyncJobService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PG_BOSS) private readonly boss: PgBoss,
  ) {}

  async enqueue(tenantId: string, datasetId: string, mappingId: string): Promise<SyncJob> {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.syncJob.create({ data: { tenantId, datasetId, mappingId, status: 'pending' } });
      const pgBossJobId = await this.boss.send(SYNC_JOB_QUEUE, { syncJobId: job.id }, {
        retryLimit: 3,
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: 14400,
      });
      return tx.syncJob.update({ where: { id: job.id }, data: { pgBossJobId } });
    });
  }

  async getJob(tenantId: string, id: string): Promise<SyncJob> {
    const job = await this.prisma.syncJob.findFirst({ where: { tenantId, id } });
    if (!job) throw new NotFoundException(`SyncJob ${id} not found`);
    return job;
  }

  listJobs(tenantId: string, datasetId?: string): Promise<SyncJob[]> {
    return this.prisma.syncJob.findMany({
      where: { tenantId, ...(datasetId ? { datasetId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }
}
