import { Module } from '@nestjs/common';
import { PipelineService } from './pipeline.service';
import { PipelineRunService } from './pipeline-run.service';
import { PipelineRunWorker } from './pipeline-run.worker';
import { DataPipelineOrchestrator } from './data-pipeline.orchestrator';
import { DatasetModule } from '../dataset/dataset.module';

@Module({
  imports: [DatasetModule],
  providers: [PipelineService, PipelineRunService, PipelineRunWorker, DataPipelineOrchestrator],
  exports: [PipelineService, PipelineRunService, DataPipelineOrchestrator],
})
export class PipelineModule {}
