import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from './tool.interface';
import { OntologySdkService } from '../sdk/ontology-sdk.service';
import type { ObjectEdit } from '@omaha/shared-types';

@Injectable()
export class CreateObjectTypeTool implements AgentTool {
  name = 'create_object_type';
  description = '创建新的对象类型，包含属性定义。用于数据导入前建立数据结构。';
  parameters = {
    type: 'object',
    properties: {
      name: { type: 'string', description: '对象类型英文名（如 customer, order）' },
      label: { type: 'string', description: '对象类型中文标签（如 客户, 订单）' },
      properties: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string', enum: ['string', 'number', 'date', 'boolean'] },
            label: { type: 'string' },
            filterable: { type: 'boolean' },
            sortable: { type: 'boolean' },
          },
          required: ['name', 'type', 'label'],
        },
      },
    },
    required: ['name', 'label', 'properties'],
  };
  requiresConfirmation = true;

  constructor(private readonly sdk: OntologySdkService) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ObjectEdit[]> {
    await this.sdk.createObjectType(context.user.tenantId, args as any);
    const edit: ObjectEdit = {
      op: 'create',
      objectType: args.name as string,
      properties: {},
      label: args.label as string,
    };
    return [edit];
  }
}
