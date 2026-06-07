import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from './tool.interface';
import { OntologySdk } from '../../ontology/ontology.sdk';

@Injectable()
export class UpdateObjectTypeTool implements AgentTool {
  name = 'update_object_type';
  description = '修改对象类型：添加/删除/修改属性，更改 filterable/sortable 标记，修改 label。';
  parameters = {
    type: 'object',
    properties: {
      objectTypeName: { type: 'string', description: '要修改的对象类型名称' },
      label: { type: 'string', description: '新的中文标签（可选）' },
      properties: {
        type: 'array',
        description: '完整的属性列表（替换现有属性）',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string', enum: ['string', 'number', 'date', 'boolean'] },
            label: { type: 'string' },
            filterable: { type: 'boolean' },
            sortable: { type: 'boolean' },
            allowedValues: {
              type: 'array',
              items: { type: 'string' },
              description: '该 string 字段的合法值枚举（硬约束）；导入时不在此列表内的值会被整批拒绝。仅低基数受控字段需要。',
            },
          },
          required: ['name', 'type', 'label', 'filterable', 'sortable', 'allowedValues'],
          additionalProperties: false,
        },
      },
      derivedProperties: {
        type: 'array',
        description: '派生属性列表（DSL 计算字段）',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '派生属性英文名' },
            label: { type: 'string', description: '中文展示名' },
            expression: { type: 'string', description: 'DSL 表达式，如 "sum orders.quantity"、"price * 0.9"' },
            params: {
              type: 'array',
              description: '可选参数列表（用于参数化表达式）',
              items: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string' } }, required: ['name', 'type'], additionalProperties: false },
            },
          },
          required: ['name', 'label', 'expression', 'params'],
          additionalProperties: false,
        },
      },
    },
    required: ['objectTypeName', 'label', 'properties', 'derivedProperties'],
    additionalProperties: false,
  };
  requiresConfirmation = true;

  constructor(private readonly sdk: OntologySdk) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    return this.sdk.updateObjectType(context.user, args as any);
  }
}
