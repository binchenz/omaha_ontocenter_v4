import { forwardRef, Module } from '@nestjs/common';
import { PipelineService } from './pipeline.service';
import { PipelineRunService } from './pipeline-run.service';
import { PipelineRunWorker } from './pipeline-run.worker';
import { DataPipelineOrchestrator } from './data-pipeline.orchestrator';
import { DatasetModule } from '../dataset/dataset.module';
import { TransformConfigModule } from '../transform-config/transform-config.module';
import { OntologyModule } from '../ontology/ontology.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { ConfigurePipelineTool } from './tools/configure-pipeline.tool';
import { TriggerPipelineRunTool } from './tools/trigger-pipeline-run.tool';
import { GetPipelineStatusTool } from './tools/get-pipeline-status.tool';
import { AvcPipelineProvisioner } from './avc-pipeline-provisioner.service';

@Module({
  imports: [forwardRef(() => DatasetModule), TransformConfigModule, OntologyModule],
  providers: [
    PipelineService,
    PipelineRunService,
    PipelineRunWorker,
    DataPipelineOrchestrator,
    ConfigurePipelineTool,
    TriggerPipelineRunTool,
    GetPipelineStatusTool,
    AvcPipelineProvisioner,
    ...ToolRegistryModule.providers(ConfigurePipelineTool, TriggerPipelineRunTool, GetPipelineStatusTool),
  ],
  exports: [PipelineService, PipelineRunService, DataPipelineOrchestrator, AvcPipelineProvisioner],
})
export class PipelineModule {}
