import { Module } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { ActionExecutor } from './action-executor.service';
import { CreateActionTool } from './tools/create-action.tool';
import { ExecuteActionTool } from './tools/execute-action.tool';
import { ApplyModule } from '../apply/apply.module';

@Module({
  imports: [ApplyModule],
  providers: [ActionExecutor, CreateActionTool, ExecuteActionTool],
  exports: [ActionExecutor, CreateActionTool, ExecuteActionTool],
})
export class ActionModule {}
