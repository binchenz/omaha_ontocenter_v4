import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { AgentTool, ToolContext } from '../../agent/tools/tool.interface';
import { AgentImportExecutor, AgentImportPayload } from '../agent-import-executor';

@Injectable()
export class ExecuteImportTool implements AgentTool {
  name = 'execute_import';
  description = '执行已确认的导入动作（需要用户先通过确认卡片批准）。返回排队结果。';
  parameters = {
    type: 'object',
    properties: {
      actionId: { type: 'string', description: '待执行的导入动作 ID' },
    },
    required: ['actionId'],
    additionalProperties: false,
  };
  requiresConfirmation = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly executor: AgentImportExecutor,
  ) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const actionId = args.actionId as string;

    // 1. Fetch the PendingAction
    const action = await this.prisma.pendingAction.findUnique({
      where: { id: actionId },
    });

    if (!action || action.tenantId !== context.user.tenantId) {
      throw new ConflictException('Action not found');
    }

    // 2. Check status
    if (action.status !== 'approved') {
      throw new ConflictException('Action must be approved before execution');
    }

    // 3. Execute import
    const payload = action.payload as unknown as AgentImportPayload;
    await this.executor.execute(context.user.tenantId, actionId, payload);

    return {
      message: '导入已排队',
      actionId,
    };
  }
}
