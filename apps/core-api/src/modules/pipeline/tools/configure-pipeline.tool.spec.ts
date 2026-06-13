import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigurePipelineTool } from './configure-pipeline.tool';
import { PipelineService } from '../pipeline.service';
import { ToolContext } from '../../agent/tools/tool.interface';
import { PIPELINE_STEP_SCHEMAS } from '../pipeline-step.schemas';

describe('ConfigurePipelineTool', () => {
  let tool: ConfigurePipelineTool;
  let service: jest.Mocked<PipelineService>;

  const ctx: ToolContext = {
    user: { id: 'u1', tenantId: 'tenant-1', email: 'a@b.c' } as any,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfigurePipelineTool,
        {
          provide: PipelineService,
          useValue: { configurePipeline: jest.fn() },
        },
      ],
    }).compile();
    tool = module.get(ConfigurePipelineTool);
    service = module.get(PipelineService);
  });

  it('constrains step `type` to the PipelineStep enum', () => {
    const stepType = (tool.parameters as any).properties.steps.items.properties.type;
    expect(stepType.enum.sort()).toEqual(Object.keys(PIPELINE_STEP_SCHEMAS).sort());
  });

  it('creates a pipeline atomically and returns { pipelineId, status }, resolving tenant from context', async () => {
    service.configurePipeline.mockResolvedValue({ pipelineId: 'p-1', status: 'active' });
    const args = {
      name: 'clean-avc',
      connectorId: 'c1',
      outputObjectTypeId: 'ot1',
      steps: [{ order: 1, type: 'filter', config: { field: 'status', operator: 'eq', value: 'active' } }],
    };
    const result = await tool.execute(args, ctx);
    expect(service.configurePipeline).toHaveBeenCalledWith('tenant-1', {
      name: 'clean-avc',
      connectorId: 'c1',
      outputObjectTypeId: 'ot1',
      steps: args.steps,
      autoActivate: undefined,
    });
    expect(result).toEqual({ pipelineId: 'p-1', status: 'active' });
  });

  it('forwards autoActivate through to the service', async () => {
    service.configurePipeline.mockResolvedValue({ pipelineId: 'p-1', status: 'draft' });
    await tool.execute(
      { name: 'x', connectorId: 'c1', outputObjectTypeId: 'ot1', steps: [], autoActivate: false },
      ctx,
    );
    expect(service.configurePipeline).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ autoActivate: false }),
    );
  });

  it('surfaces a validation failure as a usable error message', async () => {
    service.configurePipeline.mockRejectedValue(new BadRequestException('Invalid filter step config: bad'));
    await expect(
      tool.execute({ name: 'x', connectorId: 'c1', outputObjectTypeId: 'ot1', steps: [] }, ctx),
    ).rejects.toThrow('Invalid filter step config');
  });
});
