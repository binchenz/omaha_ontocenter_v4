import { CoreSdkService } from '../../../sdk/core-sdk.service';
import { CurrentUser } from '@omaha/shared-types';

const ADMIN: CurrentUser = {
  id: 'u1', email: 'a@a', name: 'A', tenantId: 'tenant-1', roleId: 'r1',
  roleName: 'admin', permissions: ['*'], permissionRules: [{ permission: '*' }],
};

describe('CoreSdkService', () => {
  const mockTypeResolver = {
    resolve: jest.fn(),
    resolveMany: jest.fn(),
    invalidate: jest.fn(),
  };
  const mockOntologyService = {
    listObjectTypes: jest.fn(),
    updateObjectType: jest.fn().mockResolvedValue({ id: 'type-1' }),
    deleteObjectType: jest.fn().mockResolvedValue({ id: 'type-1' }),
    listRelationships: jest.fn(),
    createRelationship: jest.fn().mockResolvedValue({ id: 'rel-1' }),
    deleteRelationship: jest.fn().mockResolvedValue({ id: 'rel-1' }),
  };
  const mockQueryService = {};
  const mockPrisma: any = {
    $transaction: jest.fn(async (fn: (tx: any) => Promise<any>) => fn(mockPrisma)),
    objectInstance: {
      updateMany: jest.fn().mockResolvedValue({ count: 5 }),
    },
  };

  let sdk: CoreSdkService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockTypeResolver.resolve.mockResolvedValue('resolved-id');
    mockTypeResolver.resolveMany.mockResolvedValue(new Map([
      ['Source', 'source-id'],
      ['Target', 'target-id'],
    ]));
    sdk = new CoreSdkService(
      mockOntologyService as any,
      mockQueryService as any,
      mockPrisma,
      mockTypeResolver as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('deleteObjectType is atomic — uses $transaction', async () => {
    await sdk.deleteObjectType(ADMIN, 'Customer');

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockTypeResolver.resolve).toHaveBeenCalledWith('tenant-1', 'Customer');
    expect(mockPrisma.objectInstance.updateMany).toHaveBeenCalled();
    expect(mockOntologyService.deleteObjectType).toHaveBeenCalledWith('tenant-1', 'resolved-id');
  });

  it('methods use TypeResolver instead of listObjectTypes directly', async () => {
    await sdk.updateObjectType(ADMIN, {
      objectTypeName: 'Order',
      properties: [{ name: 'amount', type: 'number', label: '金额' }],
    });

    expect(mockTypeResolver.resolve).toHaveBeenCalledWith('tenant-1', 'Order');
    expect(mockOntologyService.listObjectTypes).not.toHaveBeenCalled();
  });

  it('createRelationship uses resolveMany for source + target', async () => {
    await sdk.createRelationship(ADMIN, {
      name: 'has_orders',
      sourceType: 'Source',
      targetType: 'Target',
      cardinality: 'one-to-many',
    });

    expect(mockTypeResolver.resolveMany).toHaveBeenCalledWith('tenant-1', ['Source', 'Target']);
    expect(mockOntologyService.createRelationship).toHaveBeenCalledWith('tenant-1', {
      name: 'has_orders',
      sourceTypeId: 'source-id',
      targetTypeId: 'target-id',
      cardinality: 'one-to-many',
    });
  });
});
