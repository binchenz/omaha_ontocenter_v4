import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { TriggerPipelineRunTool } from './trigger-pipeline-run.tool';
import { PipelineRunService } from '../pipeline-run.service';
import { ToolContext } from '../../agent/tools/tool.interface';

describe('TriggerPipelineRunTool', () => {
  let tool: TriggerPipelineRunTool;
  let service: jest.Mocked<PipelineRunService>;

  const ctx: ToolContext = {
    user: { id: 'u1', tenantId: 'tenant-1', email: 'a@b.c' } as any,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TriggerPipelineRunTool,
        {
          provide: PipelineRunService,
          useValue: { enqueue: jest.fn() },
        },
      ],
    }).compile();
    tool = module.get(TriggerPipelineRunTool);
    service = module.get(PipelineRunService);
  });

  it('requires pipelineId and inputDatasetId', () => {
    expect((tool.parameters as any).required.sort()).toEqual(['inputDatasetId', 'pipelineId']);
  });

  it('enqueues a run and returns { runId, status }, resolving tenant from context', async () => {
    service.enqueue.mockResolvedValue({ id: 'run-1', status: 'pending' } as any);
    const result = await tool.execute({ pipelineId: 'p1', inputDatasetId: 'ds1' }, ctx);
    expect(service.enqueue).toHaveBeenCalledWith('tenant-1', 'p1', 'ds1');
    expect(result).toEqual({ runId: 'run-1', status: 'pending' });
  });

  it('surfaces a not-found error usefully', async () => {
    service.enqueue.mockRejectedValue(new NotFoundException('Pipeline p9 not found'));
    await expect(
      tool.execute({ pipelineId: 'p9', inputDatasetId: 'ds1' }, ctx),
    ).rejects.toThrow('not found');
  });
});
