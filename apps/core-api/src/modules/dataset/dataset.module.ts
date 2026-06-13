import { forwardRef, Module } from '@nestjs/common';
import { DatasetService, DATASET_PIPELINE_TRIGGER } from './dataset.service';
import { SyncJobService } from './sync-job.service';
import { SyncJobWorker } from './sync-job.worker';
import { PgBossService, pgBossProvider } from './pg-boss.provider';
import { AgentSdkModule } from '../agent/sdk/agent-sdk.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { DataPipelineOrchestrator } from '../pipeline/data-pipeline.orchestrator';

@Module({
  imports: [AgentSdkModule, forwardRef(() => PipelineModule)],
  providers: [
    PgBossService,
    pgBossProvider,
    DatasetService,
    SyncJobService,
    SyncJobWorker,
    // Reactive trigger seam (#168): bind the abstract token to the concrete orchestrator.
    { provide: DATASET_PIPELINE_TRIGGER, useExisting: DataPipelineOrchestrator },
  ],
  exports: [DatasetService, SyncJobService, PgBossService, pgBossProvider],
})
export class DatasetModule {}
