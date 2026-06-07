import { Module } from '@nestjs/common';
import { DatasetService } from './dataset.service';
import { SyncJobService } from './sync-job.service';
import { SyncJobWorker } from './sync-job.worker';
import { PgBossService, pgBossProvider } from './pg-boss.provider';
import { AgentSdkModule } from '../agent/sdk/agent-sdk.module';

@Module({
  imports: [AgentSdkModule],
  providers: [PgBossService, pgBossProvider, DatasetService, SyncJobService, SyncJobWorker],
  exports: [DatasetService, SyncJobService, PgBossService],
})
export class DatasetModule {}
