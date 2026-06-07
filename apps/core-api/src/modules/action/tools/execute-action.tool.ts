import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from '../../agent/tools/tool.interface';
import { ActionExecutor } from '../action-executor.service';

@Injectable()
export class ExecuteActionTool implements AgentTool {
  name = 'execute_action';
  description = '在指定对象实例上执行一个已定义的 Action。会先预览变更，需要用户确认后执行。';
  parameters = {
    type: 'object',
    properties: {
      actionName: { type: 'string', description: 'Action 名称（英文 snake_case）' },
      objectId: { type: 'string', description: '目标对象实例 ID' },
      params: {
        type: 'object',
        description: 'Action 参数键值对',
        additionalProperties: true,
      },
    },
    required: ['actionName', 'objectId'],
    additionalProperties: false,
  };
  requiresConfirmation = true;

  constructor(private readonly actionExecutor: ActionExecutor) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const tenantId = context.user.tenantId;
    const userId = context.user.id;
    const actionName = args.actionName as string;
    const objectId = args.objectId as string;
    const params = (args.params as Record<string, unknown>) ?? {};

    const result = await this.actionExecutor.execute(tenantId, userId, actionName, objectId, params);

    if (!result.ok) {
      return { error: result.error };
    }

    return {
      message: `Action "${actionName}" 执行成功`,
      changes: result.changes,
    };
  }
}
