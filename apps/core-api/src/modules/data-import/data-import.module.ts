import { Module } from '@nestjs/common';
import { PendingActionModule } from '../pending-action/pending-action.module';
import { DatasetModule } from '../dataset/dataset.module';
import { FileParserService } from '../agent/tools/file-parser.service';
import { ReadFilePreviewTool } from '../agent/tools/read-file-preview.tool';
import { AgentImportExecutor } from './agent-import-executor';
import { InlineTransformEngine } from './inline-transform-engine';
import { PreviewImportFileTool } from './tools/preview-import-file.tool';
import { ExecuteImportTool } from './tools/execute-import.tool';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';

@Module({
  imports: [PendingActionModule, DatasetModule],
  providers: [
    AgentImportExecutor,
    InlineTransformEngine,
    PreviewImportFileTool,
    ExecuteImportTool,
    FileParserService,
    ReadFilePreviewTool,
    ...ToolRegistryModule.providers(PreviewImportFileTool, ExecuteImportTool),
  ],
  exports: [AgentImportExecutor, ReadFilePreviewTool],
})
export class DataImportModule {}
