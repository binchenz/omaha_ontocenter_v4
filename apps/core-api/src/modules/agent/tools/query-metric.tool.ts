import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from './tool.interface';
import { MetricQueryService } from '../../query/metric-query.service';
import type { MetricIntent } from '../../query/metric-resolver';

/**
 * query_metric (ADR-0064 §4) — the "select a metric" tool. The LLM picks a metric
 * NAME from the catalogue (or a synonym: 销额/GMV → 零售额) plus dimensions / time /
 * intent; the engine deterministically resolves the star, pins the metric, runs the
 * aggregate, and returns the slice-① envelope with the correct caliber. The LLM's
 * output space narrows from "compose a query plan" to "choose a metric" — the
 * accuracy law. Falls back to aggregate_objects for anything off-catalogue.
 */
@Injectable()
export class QueryMetricTool implements AgentTool {
  name = 'query_metric';
  description = [
    '按【指标目录】取数：你只需选指标名 + 维度 + 时间 + 意图，引擎自动选对星、定口径、聚合、格式化。',
    '能用本工具就优先用它（比 aggregate_objects 更准）：它把"拼查询"降级成"选指标"，数值口径与单位由引擎保证。',
    '指标名支持同义词（如 销额/GMV/卖了多少钱 → 零售额）。目录外的指标会报 METRIC_NOT_IN_CATALOGUE，那时才改用 aggregate_objects。',
    '返回的 groups[].measures[指标名].display 是已格式化好的最终写法，原样引用即可（见金额铁律）。',
  ].join('\n');
  parameters = {
    type: 'object',
    properties: {
      metric: { type: 'string', description: '指标名或同义词（如 零售额 / 销额 / GMV）。' },
      dimensions: {
        type: 'object',
        description: '维度过滤，键值对（如 {"category":"电饭煲"}）。category 通常必填。',
        additionalProperties: { type: 'string' },
      },
      time: {
        type: 'object',
        description: '时间过滤，键值对（如 {"month":"26.04"} 或 {"year":"25"}）。intent=lookup 时填具体期；intent=trend 时留空让引擎按时间轴分组。',
        additionalProperties: { type: 'string' },
      },
      intent: {
        type: 'string',
        enum: ['lookup', 'trend', 'rank'],
        description: 'lookup=单点取数；trend=按时间轴出序列；rank=按某维度排名（需配 rankBy）。',
      },
      rankBy: { type: 'string', description: 'intent=rank 时，按哪个维度排名（如 brand）。' },
    },
    required: ['metric', 'dimensions', 'time', 'intent', 'rankBy'],
    additionalProperties: false,
  };
  requiresConfirmation = false;

  constructor(private readonly metricQuery: MetricQueryService) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    return this.metricQuery.query(context.user, {
      metric: args.metric as string,
      dimensions: (args.dimensions as Record<string, string>) ?? {},
      time: (args.time as Record<string, string>) ?? {},
      intent: (args.intent as MetricIntent) ?? 'lookup',
      rankBy: (args.rankBy as string) || undefined,
    });
  }
}
