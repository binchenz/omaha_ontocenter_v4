import { Module } from '@nestjs/common';
import { ActionExecutor } from './action-executor.service';
import { CreateActionTool } from './tools/create-action.tool';
import { ExecuteActionTool } from './tools/execute-action.tool';
import { ApplyModule } from '../apply/apply.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';

@Module({
  imports: [ApplyModule],
  providers: [
    ActionExecutor,
    CreateActionTool,
    ExecuteActionTool,
    ...ToolRegistryModule.providers(CreateActionTool, ExecuteActionTool),
  ],
  exports: [ActionExecutor],
})
export class ActionModule {}
