import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from './tool.interface';
import { OntologySdk } from '../../ontology/ontology.sdk';
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
      description: { type: 'string', description: '对象类型的业务含义（如"配送订单，记录从商家到客户的完整配送过程"）' },
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
            description: { type: 'string', description: '字段的业务含义' },
            unit: { type: 'string', description: '度量单位（如 km, min, 元, 个）' },
            allowedValues: {
              type: 'array',
              items: { type: 'string' },
              description: '该 string 字段的合法值枚举（硬约束）。仅低基数受控字段（如状态/等级/类型/关系类型）需要；设置后，导入时不在此列表内的值会被整批拒绝。先和用户确认合法值集合，不要凭数据猜。',
            },
          },
          required: ['name', 'type', 'label', 'filterable', 'sortable', 'description', 'unit', 'allowedValues'],
          additionalProperties: false,
        },
      },
    },
    required: ['name', 'label', 'description', 'properties'],
    additionalProperties: false,
  };
  requiresConfirmation = true;

  constructor(private readonly sdk: OntologySdk) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ObjectEdit[]> {
    await this.sdk.createObjectType(context.user, args as any);
    const edit: ObjectEdit = {
      op: 'create',
      objectType: args.name as string,
      properties: {},
      label: args.label as string,
    };
    return [edit];
  }
}
