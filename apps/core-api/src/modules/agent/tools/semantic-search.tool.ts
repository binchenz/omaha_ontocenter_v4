import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from './tool.interface';
import { CoreSdkService } from '../../sdk/core-sdk.service';

@Injectable()
export class SemanticSearchTool implements AgentTool {
  name = 'semantic_search';
  description =
    '在已导入的调研报告中做语义检索，返回与问题最相关的叙述片段及其出处（报告标题/机构/季度/页码）。用于回答"用户为什么…""用户最关注什么""有哪些发现/结论"等叙述性问题。可按品类、价格段缩小范围。';
  parameters = {
    type: 'object',
    properties: {
      query: { type: 'string', description: '检索问题（自然语言）' },
      category: { type: 'string', description: '限定品类（如 电饭煲、空气炸锅、净水器），可选但强烈建议' },
      priceBand: { type: 'string', description: '限定价格段（如 400-699），可选' },
      k: { type: 'number', description: '返回片段数，默认 6' },
    },
    required: ['query'],
  };
  requiresConfirmation = false;

  constructor(private readonly sdk: CoreSdkService) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    return this.sdk.searchResearch(context.user, {
      query: args.query as string,
      category: args.category as string | undefined,
      priceBand: args.priceBand as string | undefined,
      k: args.k as number | undefined,
    });
  }
}
