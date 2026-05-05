import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from './tool.interface';
import { OntologySdkService } from '../sdk/ontology-sdk.service';

@Injectable()
export class CreateRelationshipTool implements AgentTool {
  name = 'create_relationship';
  description = '在两个对象类型之间创建关系。';
  parameters = {
    type: 'object',
    properties: {
      name: { type: 'string', description: '关系名称（如 has_orders, contains_products）' },
      sourceType: { type: 'string', description: '源对象类型名称' },
      targetType: { type: 'string', description: '目标对象类型名称' },
      cardinality: { type: 'string', enum: ['one-to-one', 'one-to-many', 'many-to-many'], description: '基数' },
    },
    required: ['name', 'sourceType', 'targetType', 'cardinality'],
  };
  requiresConfirmation = true;

  constructor(private readonly sdk: OntologySdkService) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    return this.sdk.createRelationship(context.user.tenantId, args as any);
  }
}
