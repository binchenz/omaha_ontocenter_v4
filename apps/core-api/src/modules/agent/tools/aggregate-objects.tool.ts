import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from './tool.interface';
import { CoreSdkService } from '../../sdk/core-sdk.service';

@Injectable()
export class AggregateObjectsTool implements AgentTool {
  name = 'aggregate_objects';
  description = [
    '聚合查询对象实例，返回汇总指标（如计数、求和、平均、最大、最小）。',
    '与 query_objects 互补：query_objects 返回原始实例行；aggregate_objects 返回数值/分组汇总。',
    '当用户问"几个/多少/总数/平均/最高/最低/分布"等汇总性问题时使用本工具，不要用 query_objects 翻页统计。',
    '示例：',
    '- "评分大于 90 的书有几本" → metrics: [{ kind: "count", alias: "n" }] + filters',
    '- "每个 pace_type 多少本书" → groupBy: ["pace_type"] + count',
    '- "提及次数最高的 5 个角色" → groupBy: ["character_name_raw"] + count + orderBy desc + maxGroups: 5',
    '- "评分大于 90 的书总字数" → metrics: [{ kind: "sum", field: "total_chars", alias: "total" }]',
  ].join('\n');
  parameters = {
    type: 'object',
    properties: {
      objectType: { type: 'string', description: '要聚合的对象类型名称' },
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
        description: '过滤条件数组（同 query_objects）。注意：当用户说"大于 X"、"高于 X"时，倾向用 gte（含 X），除非明确说"严格大于"/"不含 X"。',
      },
      groupBy: {
        type: 'array',
        items: { type: 'string' },
        description: '按这些字段分组。每个字段必须是 filterable 的；json/array 类型字段（如 tags）不可分组，会返回 PROPERTY_NOT_GROUPABLE，此时改用 query_objects 的 search 参数。',
      },
      metrics: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['kind', 'alias'],
          properties: {
            kind: { type: 'string', enum: ['count', 'countDistinct', 'sum', 'avg', 'min', 'max'] },
            field: { type: 'string', description: 'sum/avg/min/max/countDistinct 必填；count 不要传' },
            alias: { type: 'string', description: '返回值里这个 metric 的 key 名（用户友好的简短英文，如 n / avg_score / total_chars）' },
          },
        },
        description: '指标数组，至少 1 项。',
      },
      orderBy: {
        type: 'array',
        maxItems: 1,
        items: {
          type: 'object',
          required: ['kind', 'by', 'direction'],
          properties: {
            kind: { type: 'string', enum: ['metric', 'groupKey'] },
            by: { type: 'string', description: 'kind=metric 时填 alias；kind=groupKey 时填字段名' },
            direction: { type: 'string', enum: ['asc', 'desc'] },
          },
        },
        description: '排序，目前只支持单个键。不指定时返回顺序未定义。',
      },
      maxGroups: { type: 'number', description: '默认 100，硬上限 500（超出会自动 clamp 并发 warning）' },
      pageToken: { type: 'string', description: '用上一次响应的 nextPageToken 翻页' },
    },
    required: ['objectType', 'metrics'],
  };
  requiresConfirmation = false;

  constructor(private readonly sdk: CoreSdkService) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    return this.sdk.aggregateObjects(context.user as any, {
      objectType: args.objectType as string,
      filters: (args.filters as any[]) ?? [],
      groupBy: (args.groupBy as string[]) ?? [],
      metrics: args.metrics as any[],
      orderBy: args.orderBy as any[],
      maxGroups: args.maxGroups as number | undefined,
      pageToken: args.pageToken as string | undefined,
    });
  }
}
