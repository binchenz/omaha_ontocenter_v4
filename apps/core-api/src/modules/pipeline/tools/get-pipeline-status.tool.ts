import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from '../../agent/tools/tool.interface';
import { PipelineService } from '../pipeline.service';
import { PipelineRunService } from '../pipeline-run.service';

/**
 * Agent tool: read Pipeline(s) and their recent runs (#173, Q15 passive-query model).
 * With a pipelineId returns that one Pipeline; without, lists every tenant Pipeline.
 * Each run surfaces its { step, rowIndex, message } failure detail so the Agent can
 * explain a failure to the user in natural language. Tenant-scoped via context.
 */
@Injectable()
export class GetPipelineStatusTool implements AgentTool {
  name = 'get_pipeline_status';
  description =
    '查询管道及其最近运行状态。可选 pipelineId；不传则列出本租户全部管道。失败运行会附带 { step, rowIndex, message } 详情。';
  parameters = {
    type: 'object',
    properties: {
      pipelineId: { type: 'string', description: '可选；指定则只返回该管道，否则返回全部' },
    },
    required: [],
    additionalProperties: false,
  };
  requiresConfirmation = false;

  constructor(
    private readonly pipelineService: PipelineService,
    private readonly runService: PipelineRunService,
  ) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const tenantId = context.user.tenantId;
    const pipelineId = args.pipelineId as string | undefined;

    const pipelines = pipelineId
      ? [await this.pipelineService.getPipeline(tenantId, pipelineId)]
      : await this.pipelineService.listPipelines(tenantId);

    const result = await Promise.all(
      pipelines.map(async (pipeline) => {
        const runs = await this.runService.listRuns(tenantId, pipeline.id);
        return {
          pipeline,
          recentRuns: runs.map((r) => ({
            runId: r.id,
            status: r.status,
            recordsProcessed: r.recordsProcessed,
            error: r.error ?? null,
          })),
        };
      }),
    );

    return { pipelines: result };
  }
}
