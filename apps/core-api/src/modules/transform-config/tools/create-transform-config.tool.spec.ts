import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CreateTransformConfigTool } from './create-transform-config.tool';
import { TransformConfigService } from '../transform-config.service';
import { ToolContext } from '../../agent/tools/tool.interface';

describe('CreateTransformConfigTool', () => {
  let tool: CreateTransformConfigTool;
  let service: jest.Mocked<TransformConfigService>;

  const ctx: ToolContext = {
    user: { id: 'u1', tenantId: 'tenant-1', email: 'a@b.c' } as any,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreateTransformConfigTool,
        {
          provide: TransformConfigService,
          useValue: { create: jest.fn() },
        },
      ],
    }).compile();
    tool = module.get(CreateTransformConfigTool);
    service = module.get(TransformConfigService);
  });

  it('constrains `type` to the TransformConfig enum', () => {
    const t = (tool.parameters as any).properties.type;
    expect(t.enum.sort()).toEqual(['brand_mapping', 'price_bands']);
  });

  it('creates a config and returns { id, name, version }, resolving tenant from context', async () => {
    service.create.mockResolvedValue({ id: 'tc-1', name: 'brands', version: 1 } as any);
    const result = await tool.execute(
      { name: 'brands', type: 'brand_mapping', config: { mappings: { hw: 'Huawei' } } },
      ctx,
    );
    expect(service.create).toHaveBeenCalledWith('tenant-1', {
      name: 'brands',
      type: 'brand_mapping',
      config: { mappings: { hw: 'Huawei' } },
    });
    expect(result).toEqual({ id: 'tc-1', name: 'brands', version: 1 });
  });

  it('surfaces a validation failure as a usable error message', async () => {
    service.create.mockRejectedValue(new BadRequestException('Invalid brand_mapping config: bad'));
    await expect(
      tool.execute({ name: 'brands', type: 'brand_mapping', config: {} }, ctx),
    ).rejects.toThrow('Invalid brand_mapping config');
  });
});
