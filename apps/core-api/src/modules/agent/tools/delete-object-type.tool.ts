import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from './tool.interface';
import { OntologySdkService } from '../sdk/ontology-sdk.service';

@Injectable()
export class DeleteObjectTypeTool implements AgentTool {
  name = 'delete_object_type';
  description = '删除对象类型及其所有数据（软删除）。';
  parameters = {
    type: 'object',
    properties: {
      objectTypeName: { type: 'string', description: '要删除的对象类型名称' },
    },
    required: ['objectTypeName'],
  };
  requiresConfirmation = true;

  constructor(private readonly sdk: OntologySdkService) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    return this.sdk.deleteObjectType(context.user.tenantId, args.objectTypeName as string);
  }
}
