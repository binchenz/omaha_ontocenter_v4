import { Module } from '@nestjs/common';
import { TransformConfigService } from './transform-config.service';
import { CreateTransformConfigTool } from './tools/create-transform-config.tool';
import { ListTransformConfigsTool } from './tools/list-transform-configs.tool';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';

@Module({
  providers: [
    TransformConfigService,
    CreateTransformConfigTool,
    ListTransformConfigsTool,
    ...ToolRegistryModule.providers(CreateTransformConfigTool, ListTransformConfigsTool),
  ],
  exports: [TransformConfigService],
})
export class TransformConfigModule {}
