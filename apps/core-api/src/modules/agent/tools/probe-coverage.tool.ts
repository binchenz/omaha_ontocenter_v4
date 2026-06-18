import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from './tool.interface';
import { CoverageProbe } from '../../query/coverage-probe.service';
import type { QueryFilter } from '@omaha/shared-types';

/**
 * probe_coverage (ADR-0064 §3) — the tool affordance over CoverageProbe. Lets the
 * Agent ask "what periods actually exist for THIS star under THESE filters" before
 * asserting any absence. The protocol rule (research_qa skill): read cadence from
 * get_ontology_schema (the timeAxis hint), but ask coverage HERE; each star probes
 * its own coverage — never read a sibling star's report-period table to stand in.
 */
@Injectable()
export class ProbeCoverageTool implements AgentTool {
  name = 'probe_coverage';
  description = [
    '探测某颗星在它自己的时间轴上实际有哪些期次（实时查数据库，绝不靠推断）。',
    '断言"某期/某段无数据/无趋势"前，或画趋势/月度走势前，先用本工具探出真实覆盖，按探到的期次作图或回答。',
    '关键：每颗星探它自己的覆盖——查 market_metric 的月度覆盖就传 objectType=market_metric，',
    '**绝不**拿 brand_share / avc_report 的稀疏年度报告期去反推 market_metric 的月度覆盖（这正是 BUG-2 根因）。',
    '返回 { field（时间轴字段）, values（实际期次，已排序）, min, max, isDense（是否连续稠密序列）}。',
  ].join('\n');
  parameters = {
    type: 'object',
    properties: {
      objectType: { type: 'string', description: '要探覆盖的星（如 market_metric / brand_share）。探哪颗星就传哪颗，不要跨星反推。' },
      filters: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string' },
            operator: { type: 'string', enum: ['eq', 'in'] },
            value: {},
          },
          required: ['field', 'operator', 'value'],
          additionalProperties: false,
        },
        description: '维度过滤（如 category=电饭煲、metric=零售额），把覆盖收窄到目标范围。只支持 eq / in。',
      },
    },
    required: ['objectType', 'filters'],
    additionalProperties: false,
  };
  requiresConfirmation = false;

  constructor(private readonly coverageProbe: CoverageProbe) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const user = context.user;
    return this.coverageProbe.coverage(
      user.tenantId,
      args.objectType as string,
      (args.filters as QueryFilter[]) ?? [],
    );
  }
}
