import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from '../../agent/tools/tool.interface';
import { PipelineService } from '../pipeline.service';
import { PIPELINE_STEP_SCHEMAS } from '../pipeline-step.schemas';

/**
 * Agent tool: create a Pipeline plus all its ordered Steps in one atomic call (#172, Q6/Q10 design Y).
 * The Agent supplies the full intent; no step-by-step low-level calls are needed.
 * Each step's `config` is validated against its type schema (#166); a compute step's `configRef`
 * without an explicit `configVersion` is pinned to the current latest version (ADR-0054).
 * Partial failure persists nothing. Tenant comes from request context, not a param.
 */
@Injectable()
export class ConfigurePipelineTool implements AgentTool {
  name = 'configure_pipeline';
  description =
    '一次性创建数据管道及其全部步骤（filter/rename/compute）。compute 步骤的 configRef 若未指定版本会锁定到当前最新版本。原子操作，失败则全部不落库。返回 { pipelineId, status }。';
  parameters = {
    type: 'object',
    properties: {
      name: { type: 'string', description: '管道名称' },
      connectorId: { type: 'string', description: '输入数据来源的连接器 ID' },
      outputObjectTypeId: { type: 'string', description: '输出对象类型 ID' },
      steps: {
        type: 'array',
        description: '有序步骤列表，按 order 执行',
        items: {
          type: 'object',
          properties: {
            order: { type: 'number', description: '执行顺序（升序）' },
            type: {
              type: 'string',
              enum: Object.keys(PIPELINE_STEP_SCHEMAS),
              description: 'filter=过滤；rename=改名；compute=预定义函数转换',
            },
            config: { type: 'object', description: '步骤配置，结构由 type 决定' },
            name: { type: 'string', description: '步骤名称（可选）' },
          },
          required: ['order', 'type', 'config'],
          additionalProperties: false,
        },
      },
      autoActivate: {
        type: 'boolean',
        description: 'true=直接激活；false=保存为草稿。缺省按激活处理',
      },
    },
    required: ['name', 'connectorId', 'outputObjectTypeId', 'steps'],
    additionalProperties: false,
  };
  requiresConfirmation = false;

  constructor(private readonly service: PipelineService) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    return this.service.configurePipeline(context.user.tenantId, {
      name: args.name as string,
      connectorId: args.connectorId as string,
      outputObjectTypeId: args.outputObjectTypeId as string,
      steps: args.steps as { order: number; type: string; config: Record<string, unknown>; name?: string }[],
      autoActivate: args.autoActivate as boolean | undefined,
    });
  }
}
