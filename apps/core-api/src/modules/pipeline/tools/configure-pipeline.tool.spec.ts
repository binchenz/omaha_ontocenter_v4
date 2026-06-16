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

  it('exposes declaredInputs in the parameter schema', () => {
    const props = (tool.parameters as any).properties;
    expect(props.declaredInputs).toBeDefined();
    expect(props.declaredInputs.type).toBe('array');
    const itemProps = props.declaredInputs.items.properties;
    expect(itemProps.inputName).toBeDefined();
    expect(itemProps.connectorId).toBeDefined();
    expect(itemProps.alignKeyField).toBeDefined();
    expect(props.declaredInputs.items.required.sort()).toEqual(['connectorId', 'inputName']);
  });

  it('forwards declaredInputs through to the service for a multi-input pipeline', async () => {
    service.configurePipeline.mockResolvedValue({ pipelineId: 'p-join', status: 'active' });
    const declaredInputs = [
      { inputName: 'orders', connectorId: 'c-orders' },
      { inputName: 'refunds', connectorId: 'c-refunds', alignKeyField: 'reportMonth' },
    ];
    await tool.execute(
      { name: 'net', connectorId: 'c-orders', outputObjectTypeId: 'ot-net', steps: [], declaredInputs },
      ctx,
    );
    expect(service.configurePipeline).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ declaredInputs }),
    );
  });

  it('surfaces a validation failure as a usable error message', async () => {
    service.configurePipeline.mockRejectedValue(new BadRequestException('Invalid filter step config: bad'));
    await expect(
      tool.execute({ name: 'x', connectorId: 'c1', outputObjectTypeId: 'ot1', steps: [] }, ctx),
    ).rejects.toThrow('Invalid filter step config');
  });
});
