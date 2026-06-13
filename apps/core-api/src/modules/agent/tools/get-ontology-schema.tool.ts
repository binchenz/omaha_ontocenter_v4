import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from './tool.interface';
import { OntologySdk } from '../../ontology/ontology.sdk';

@Injectable()
export class GetOntologySchemaTool implements AgentTool {
  name = 'get_ontology_schema';
  description = '获取当前租户的本体 schema（对象类型、属性、关系）。系统提示里已列出所有类型名称作为路由菜单；当你已选定某个类型、需要它的完整字段/单位/枚举细节时，传入 typeName 只取该类型的详情；需要全部类型时不传或传空字符串。';
  parameters = {
    type: 'object',
    properties: {
      typeName: {
        type: 'string',
        description: '只返回该对象类型的完整详情（字段、单位、枚举、关系）。用于已从系统提示的类型菜单中选定类型后按需拉取细节，避免拉取全量。',
      },
    },
    required: [],
    additionalProperties: false,
  };
  requiresConfirmation = false;

  constructor(private readonly sdk: OntologySdk) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const typeName = typeof args.typeName === 'string' ? args.typeName.trim() : undefined;
    if (typeName) {
      return this.sdk.getTypeDetail(context.user.tenantId, typeName);
    }
    return this.sdk.getSchema(context.user.tenantId);
  }
}
