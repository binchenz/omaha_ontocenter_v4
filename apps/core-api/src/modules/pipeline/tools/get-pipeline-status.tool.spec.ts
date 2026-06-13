import { Test, TestingModule } from '@nestjs/testing';
import { GetPipelineStatusTool } from './get-pipeline-status.tool';
import { PipelineService } from '../pipeline.service';
import { PipelineRunService } from '../pipeline-run.service';
import { ToolContext } from '../../agent/tools/tool.interface';

describe('GetPipelineStatusTool', () => {
  let tool: GetPipelineStatusTool;
  let pipelineService: jest.Mocked<PipelineService>;
  let runService: jest.Mocked<PipelineRunService>;

  const ctx: ToolContext = {
    user: { id: 'u1', tenantId: 'tenant-1', email: 'a@b.c' } as any,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetPipelineStatusTool,
        {
          provide: PipelineService,
          useValue: { getPipeline: jest.fn(), listPipelines: jest.fn() },
        },
        {
          provide: PipelineRunService,
          useValue: { listRuns: jest.fn() },
        },
      ],
    }).compile();
    tool = module.get(GetPipelineStatusTool);
    pipelineService = module.get(PipelineService);
    runService = module.get(PipelineRunService);
  });

  it('with an id returns that pipeline + recent runs (tenant-scoped)', async () => {
    pipelineService.getPipeline.mockResolvedValue({ id: 'p1', name: 'clean-avc', status: 'active' } as any);
    runService.listRuns.mockResolvedValue([
      { id: 'run-2', status: 'success', recordsProcessed: 10, error: null },
    ] as any);
    const result: any = await tool.execute({ pipelineId: 'p1' }, ctx);
    expect(pipelineService.getPipeline).toHaveBeenCalledWith('tenant-1', 'p1');
    expect(runService.listRuns).toHaveBeenCalledWith('tenant-1', 'p1');
    expect(result.pipelines).toHaveLength(1);
    expect(result.pipelines[0].pipeline.id).toBe('p1');
    expect(result.pipelines[0].recentRuns[0]).toEqual({
      runId: 'run-2',
      status: 'success',
      recordsProcessed: 10,
      error: null,
    });
  });

  it('with no id lists all tenant pipelines, each with recent runs', async () => {
    pipelineService.listPipelines.mockResolvedValue([
      { id: 'p1', name: 'a', status: 'active' },
      { id: 'p2', name: 'b', status: 'draft' },
    ] as any);
    runService.listRuns.mockResolvedValue([] as any);
    const result: any = await tool.execute({}, ctx);
    expect(pipelineService.listPipelines).toHaveBeenCalledWith('tenant-1');
    expect(result.pipelines).toHaveLength(2);
    expect(result.pipelines.map((p: any) => p.pipeline.id)).toEqual(['p1', 'p2']);
  });

  it('surfaces the { step, rowIndex, message } failure detail in a run error', async () => {
    pipelineService.getPipeline.mockResolvedValue({ id: 'p1', name: 'x', status: 'active' } as any);
    runService.listRuns.mockResolvedValue([
      { id: 'run-9', status: 'failed', recordsProcessed: 0, error: { step: 2, rowIndex: 41, message: 'boom' } },
    ] as any);
    const result: any = await tool.execute({ pipelineId: 'p1' }, ctx);
    expect(result.pipelines[0].recentRuns[0].error).toEqual({ step: 2, rowIndex: 41, message: 'boom' });
  });
});
