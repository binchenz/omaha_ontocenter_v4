import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from './tool.interface';
import { OntologySdkService } from '../sdk/ontology-sdk.service';

@Injectable()
export class GetOntologySchemaTool implements AgentTool {
  name = 'get_ontology_schema';
  description = '获取当前租户的本体 schema，包括所有对象类型、属性、关系。用于了解可查询的数据结构。';
  parameters = {
    type: 'object',
    properties: {},
  };
  requiresConfirmation = false;

  constructor(private readonly sdk: OntologySdkService) {}

  async execute(_args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    return this.sdk.getSchema(context.user.tenantId);
  }
}
