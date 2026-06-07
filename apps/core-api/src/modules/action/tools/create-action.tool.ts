import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from '../../agent/tools/tool.interface';
import { PrismaService } from '@omaha/db';

@Injectable()
export class CreateActionTool implements AgentTool {
  name = 'create_action';
  description = '在指定对象类型上定义一个 Action（可执行操作）。Action 有参数、前置条件和副作用（effects）。';
  parameters = {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Action 英文名，snake_case，如 mark_as_followed_up' },
      label: { type: 'string', description: 'Action 中文展示名，如 "标记为已跟进"' },
      description: { type: 'string', description: 'Action 的业务含义描述' },
      objectTypeName: { type: 'string', description: '绑定的对象类型名称' },
      parameters: {
        type: 'array',
        description: 'Action 参数列表',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string', enum: ['string', 'number', 'date', 'boolean', 'objectRef'] },
            label: { type: 'string' },
            required: { type: 'boolean' },
            allowedValues: { type: 'array', items: { type: 'string' } },
            objectTypeName: { type: 'string', description: '当 type=objectRef 时，指向的对象类型' },
          },
          required: ['name', 'type', 'label', 'required'],
          additionalProperties: false,
        },
      },
      precondition: { type: 'string', description: '前置条件 DSL 表达式，如 "status = \'待跟进\'"' },
      effects: {
        type: 'array',
        description: '副作用列表',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['set_field', 'create_relationship', 'delete_relationship', 'create_object'] },
            field: { type: 'string', description: 'set_field: 要修改的字段名' },
            value: { description: 'set_field: 目标值，可以是字面量或 { fromParam: "paramName" }' },
            relationship: { type: 'string', description: 'create/delete_relationship: 关系名' },
            targetParam: { type: 'string', description: 'create/delete_relationship: 目标对象参数名' },
            objectType: { type: 'string', description: 'create_object: 要创建的对象类型' },
            fields: { type: 'object', description: 'create_object: 新对象的字段值' },
          },
          required: ['type'],
          additionalProperties: false,
        },
      },
    },
    required: ['name', 'label', 'description', 'objectTypeName', 'effects'],
    additionalProperties: false,
  };
  requiresConfirmation = true;

  constructor(private readonly prisma: PrismaService) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const tenantId = context.user.tenantId;
    const actionDef = await (this.prisma.actionDefinition as any).create({
      data: {
        tenantId,
        name: args.name as string,
        label: args.label as string,
        description: (args.description as string) ?? '',
        objectType: args.objectTypeName as string,
        parameters: (args.parameters as any[]) ?? [],
        precondition: (args.precondition as string) ?? null,
        effects: args.effects as any[],
        permission: 'object.write',
      },
    });
    return {
      message: `Action "${args.label}" 已创建，绑定到 ${args.objectTypeName}`,
      actionId: actionDef.id,
      name: actionDef.name,
    };
  }
}
