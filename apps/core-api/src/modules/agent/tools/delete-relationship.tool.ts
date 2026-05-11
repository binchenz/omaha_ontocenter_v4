import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from './tool.interface';
import { CoreSdkService } from '../../sdk/core-sdk.service';

@Injectable()
export class DeleteRelationshipTool implements AgentTool {
  name = 'delete_relationship';
  description = '删除两个对象类型之间的关系。';
  parameters = {
    type: 'object',
    properties: {
      name: { type: 'string', description: '关系名称' },
      sourceType: { type: 'string', description: '源对象类型名称' },
    },
    required: ['name', 'sourceType'],
  };
  requiresConfirmation = true;

  constructor(private readonly sdk: CoreSdkService) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    return this.sdk.deleteRelationship(context.user.tenantId, args as any);
  }
}
