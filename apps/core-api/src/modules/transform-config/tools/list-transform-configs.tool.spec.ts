import { Test, TestingModule } from '@nestjs/testing';
import { ListTransformConfigsTool } from './list-transform-configs.tool';
import { TransformConfigService } from '../transform-config.service';
import { ToolContext } from '../../agent/tools/tool.interface';

describe('ListTransformConfigsTool', () => {
  let tool: ListTransformConfigsTool;
  let service: jest.Mocked<TransformConfigService>;

  const ctx: ToolContext = {
    user: { id: 'u1', tenantId: 'tenant-1', email: 'a@b.c' } as any,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ListTransformConfigsTool,
        {
          provide: TransformConfigService,
          useValue: { list: jest.fn() },
        },
      ],
    }).compile();
    tool = module.get(ListTransformConfigsTool);
    service = module.get(TransformConfigService);
  });

  it('returns latest-per-name as { name, type, version }, tenant-scoped from context', async () => {
    service.list.mockResolvedValue([
      { id: 'tc-2', name: 'brands', type: 'brand_mapping', version: 2, config: {} },
      { id: 'tc-9', name: 'price', type: 'price_bands', version: 1, config: {} },
    ] as any);
    const result = await tool.execute({}, ctx);
    expect(service.list).toHaveBeenCalledWith('tenant-1');
    expect(result).toEqual([
      { name: 'brands', type: 'brand_mapping', version: 2 },
      { name: 'price', type: 'price_bands', version: 1 },
    ]);
  });
});
