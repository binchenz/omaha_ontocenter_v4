import { UpdateObjectTypeTool } from '../tools/update-object-type.tool';

describe('UpdateObjectTypeTool — derivedProperties', () => {
  let tool: UpdateObjectTypeTool;
  let mockSdk: any;

  beforeEach(() => {
    mockSdk = {
      updateObjectType: jest.fn().mockResolvedValue({ message: 'updated' }),
    };
    tool = new UpdateObjectTypeTool(mockSdk);
  });

  it('passes derivedProperties through to OntologySdk.updateObjectType', async () => {
    const context = { user: { tenantId: 't-1', id: 'u-1', permissions: ['*'] } } as any;
    await tool.execute({
      objectTypeName: 'product',
      label: '产品',
      properties: [],
      derivedProperties: [
        { name: 'total_sales', label: '总销量', expression: 'sum orders.quantity' },
      ],
    }, context);

    expect(mockSdk.updateObjectType).toHaveBeenCalledWith(
      context.user,
      expect.objectContaining({
        objectTypeName: 'product',
        derivedProperties: [{ name: 'total_sales', label: '总销量', expression: 'sum orders.quantity' }],
      }),
    );
  });

  it('tool schema includes derivedProperties in parameters', () => {
    expect((tool.parameters as any).properties.derivedProperties).toBeDefined();
  });
});
