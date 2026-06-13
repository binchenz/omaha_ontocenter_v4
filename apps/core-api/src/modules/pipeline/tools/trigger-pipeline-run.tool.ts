import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from '../../agent/tools/tool.interface';
import { PipelineRunService } from '../pipeline-run.service';

/**
 * Agent tool: manually enqueue a PipelineRun (#173, Q4 model C).
 * For reruns / testing a new config against an input Dataset. Tenant comes from
 * request context, not a param. Returns { runId, status }.
 */
@Injectable()
export class TriggerPipelineRunTool implements AgentTool {
  name = 'trigger_pipeline_run';
  description =
    '手动触发一条管道运行（用于重跑或测试新配置）。传入 pipelineId 和 inputDatasetId。返回 { runId, status }。';
  parameters = {
    type: 'object',
    properties: {
      pipelineId: { type: 'string', description: '要运行的管道 id' },
      inputDatasetId: { type: 'string', description: '作为输入的原始 Dataset id' },
    },
    required: ['pipelineId', 'inputDatasetId'],
    additionalProperties: false,
  };
  requiresConfirmation = false;

  constructor(private readonly service: PipelineRunService) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const run = await this.service.enqueue(
      context.user.tenantId,
      args.pipelineId as string,
      args.inputDatasetId as string,
    );
    return { runId: run.id, status: run.status };
  }
}
