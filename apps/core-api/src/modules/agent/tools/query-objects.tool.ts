import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from './tool.interface';
import { OntologySdkService } from '../sdk/ontology-sdk.service';

@Injectable()
export class QueryObjectsTool implements AgentTool {
  name = 'query_objects';
  description = '查询对象实例。根据对象类型、过滤条件、排序等参数查询数据。';
  parameters = {
    type: 'object',
    properties: {
      objectType: { type: 'string', description: '要查询的对象类型名称（如 customer, order）' },
      filters: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string' },
            operator: { type: 'string', enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in'] },
            value: {},
          },
        },
        description: '过滤条件数组',
      },
      sort: {
        type: 'object',
        properties: {
          field: { type: 'string' },
          direction: { type: 'string', enum: ['asc', 'desc'] },
        },
      },
      include: { type: 'array', items: { type: 'string' }, description: '要包含的关联关系名称' },
      page: { type: 'number' },
      pageSize: { type: 'number' },
    },
    required: ['objectType'],
  };
  requiresConfirmation = false;

  constructor(private readonly sdk: OntologySdkService) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    return this.sdk.queryObjects(context.user as any, {
      objectType: args.objectType as string,
      filters: (args.filters as any[]) ?? [],
      sort: args.sort as any,
      include: (args.include as string[]) ?? [],
      page: (args.page as number) ?? 1,
      pageSize: (args.pageSize as number) ?? 20,
    });
  }
}
