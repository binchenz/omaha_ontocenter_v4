import { TypeResolver } from '../type-resolver.service';

describe('TypeResolver', () => {
  const mockOntologyService = {
    listObjectTypes: jest.fn(),
  };

  let resolver: TypeResolver;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOntologyService.listObjectTypes.mockResolvedValue([
      { id: 'id-customer', name: 'Customer', label: '客户' },
      { id: 'id-order', name: 'Order', label: '订单' },
      { id: 'id-product', name: 'Product', label: '产品' },
    ]);
    resolver = new TypeResolver(mockOntologyService as any);
  });

  it('resolves a known type name to its ID', async () => {
    const id = await resolver.resolve('tenant-1', 'Customer');
    expect(id).toBe('id-customer');
    expect(mockOntologyService.listObjectTypes).toHaveBeenCalledWith('tenant-1');
  });

  it('throws a descriptive error for unknown type name', async () => {
    await expect(resolver.resolve('tenant-1', 'NonExistent'))
      .rejects.toThrow('对象类型 "NonExistent" 不存在');
  });

  it('caches: second call does not hit OntologyService again', async () => {
    await resolver.resolve('tenant-1', 'Customer');
    await resolver.resolve('tenant-1', 'Order');
    expect(mockOntologyService.listObjectTypes).toHaveBeenCalledTimes(1);
  });

  it('invalidate clears cache, next call re-fetches', async () => {
    await resolver.resolve('tenant-1', 'Customer');
    resolver.invalidate('tenant-1');
    await resolver.resolve('tenant-1', 'Customer');
    expect(mockOntologyService.listObjectTypes).toHaveBeenCalledTimes(2);
  });

  it('resolveMany returns a Map of name→ID', async () => {
    const result = await resolver.resolveMany('tenant-1', ['Customer', 'Order']);
    expect(result).toEqual(new Map([
      ['Customer', 'id-customer'],
      ['Order', 'id-order'],
    ]));
  });
});
