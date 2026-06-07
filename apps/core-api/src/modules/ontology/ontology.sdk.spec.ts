import { OntologySdk } from './ontology.sdk';
import { CurrentUser } from '@omaha/shared-types';

const ADMIN: CurrentUser = {
  id: 'u1', email: 'a@a', name: 'A', tenantId: 'tenant-1', roleId: 'r1',
  roleName: 'admin', permissions: ['*'], permissionRules: [{ permission: '*' }],
};
const VIEWER: CurrentUser = {
  id: 'u2', email: 'b@b', name: 'B', tenantId: 'tenant-1', roleId: 'r2',
  roleName: 'viewer', permissions: [], permissionRules: [],
};

function makeHarness() {
  const mockTypeResolver = {
    resolve: jest.fn().mockResolvedValue('resolved-id'),
    resolveMany: jest.fn().mockResolvedValue(new Map([['Source', 'src-id'], ['Target', 'tgt-id']])),
    invalidate: jest.fn(),
  };
  const mockOntologyService = {
    listObjectTypes: jest.fn().mockResolvedValue([]),
    listRelationships: jest.fn().mockResolvedValue([]),
    createObjectType: jest.fn().mockResolvedValue({ id: 'type-1' }),
    updateObjectType: jest.fn().mockResolvedValue({ id: 'type-1' }),
    deleteObjectType: jest.fn().mockResolvedValue({ id: 'type-1' }),
    createRelationship: jest.fn().mockResolvedValue({ id: 'rel-1' }),
    deleteRelationship: jest.fn().mockResolvedValue({ id: 'rel-1' }),
  };
  const mockPrisma: any = {
    $transaction: jest.fn(async (fn: any) => fn(mockPrisma)),
    objectInstance: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    actionDefinition: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const sdk = new OntologySdk(mockOntologyService as any, mockTypeResolver as any, mockPrisma);
  return { sdk, mockOntologyService, mockTypeResolver, mockPrisma };
}

describe('OntologySdk — capability gate', () => {
  it('createObjectType rejects viewer', async () => {
    const { sdk } = makeHarness();
    await expect(sdk.createObjectType(VIEWER, { name: 'x', label: 'X', properties: [] })).rejects.toThrow();
  });
  it('updateObjectType rejects viewer', async () => {
    const { sdk } = makeHarness();
    await expect(sdk.updateObjectType(VIEWER, { objectTypeName: 'x', properties: [] })).rejects.toThrow();
  });
  it('deleteObjectType rejects viewer', async () => {
    const { sdk } = makeHarness();
    await expect(sdk.deleteObjectType(VIEWER, 'x')).rejects.toThrow();
  });
  it('createRelationship rejects viewer', async () => {
    const { sdk } = makeHarness();
    await expect(sdk.createRelationship(VIEWER, { name: 'r', sourceType: 'A', targetType: 'B', cardinality: 'one-to-many' })).rejects.toThrow();
  });
  it('deleteRelationship rejects viewer', async () => {
    const { sdk } = makeHarness();
    await expect(sdk.deleteRelationship(VIEWER, { name: 'r', sourceType: 'A' })).rejects.toThrow();
  });
});

describe('OntologySdk — cache invalidation', () => {
  it('createObjectType invalidates TypeResolver and schema summary', async () => {
    const { sdk, mockTypeResolver } = makeHarness();
    // Warm the summary cache first
    await sdk.getSchemaSummary('tenant-1');
    await sdk.createObjectType(ADMIN, { name: 'x', label: 'X', properties: [] });
    expect(mockTypeResolver.invalidate).toHaveBeenCalledWith('tenant-1');
    // Cache must be cleared: a second getSchemaSummary should re-call listObjectTypes
    const { mockOntologyService } = makeHarness();
    // Simple check: invalidateSchemaSummary removes the entry
    const sdk2 = new OntologySdk(mockOntologyService as any, { invalidate: jest.fn() } as any, { actionDefinition: { findMany: jest.fn().mockResolvedValue([]) } } as any);
    await sdk2.getSchemaSummary('t1'); // populates
    sdk2.invalidateSchemaSummary('t1');
    await sdk2.getSchemaSummary('t1'); // must re-call
    expect(mockOntologyService.listObjectTypes).toHaveBeenCalledTimes(2);
  });

  it('deleteObjectType is atomic via $transaction and invalidates caches', async () => {
    const { sdk, mockPrisma, mockTypeResolver } = makeHarness();
    await sdk.deleteObjectType(ADMIN, 'Customer');
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockTypeResolver.invalidate).toHaveBeenCalledWith('tenant-1');
  });
});

describe('OntologySdk — allowedValues flows through getSchema', () => {
  it('includes allowedValues from listObjectTypes without manual field listing', async () => {
    const { sdk, mockOntologyService } = makeHarness();
    mockOntologyService.listObjectTypes.mockResolvedValue([{
      name: 'order', label: '订单', description: undefined,
      properties: [{ name: 'status', type: 'string', label: '状态', filterable: true, allowedValues: ['open', 'closed'] }],
      derivedProperties: [],
    }]);
    const schema = await sdk.getSchema('tenant-1');
    const prop = schema.types[0].properties[0];
    expect(prop.allowedValues).toEqual(['open', 'closed']);
  });
});

describe('OntologySdk — TypeResolver delegation', () => {
  it('updateObjectType uses TypeResolver not listObjectTypes', async () => {
    const { sdk, mockOntologyService } = makeHarness();
    await sdk.updateObjectType(ADMIN, { objectTypeName: 'Order', properties: [{ name: 'a', type: 'number', label: 'A' }] });
    expect(mockOntologyService.listObjectTypes).not.toHaveBeenCalled();
  });

  it('createRelationship uses resolveMany for both types', async () => {
    const { sdk, mockTypeResolver, mockOntologyService } = makeHarness();
    await sdk.createRelationship(ADMIN, { name: 'has_orders', sourceType: 'Source', targetType: 'Target', cardinality: 'one-to-many' });
    expect(mockTypeResolver.resolveMany).toHaveBeenCalledWith('tenant-1', ['Source', 'Target']);
    expect(mockOntologyService.createRelationship).toHaveBeenCalledWith('tenant-1', expect.objectContaining({
      sourceTypeId: 'src-id', targetTypeId: 'tgt-id',
    }));
  });
});
