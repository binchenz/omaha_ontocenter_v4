import { Test, TestingModule } from '@nestjs/testing';
import { QueryService } from './query.service';
import { PrismaService } from '@omaha/db';
import { PermissionService } from '../permission/permission.service';
import { ForbiddenException } from '@nestjs/common';

describe('QueryService', () => {
  let service: QueryService;
  let prisma: {
    objectInstance: {
      findMany: jest.Mock;
      count: jest.Mock;
    };
  };
  let permissionService: {
    canAccess: jest.Mock;
    assertCanAccess: jest.Mock;
    filterFields: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      objectInstance: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };
    permissionService = {
      canAccess: jest.fn().mockReturnValue(true),
      assertCanAccess: jest.fn(),
      filterFields: jest.fn().mockImplementation((props) => props),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueryService,
        { provide: PrismaService, useValue: prisma },
        { provide: PermissionService, useValue: permissionService },
      ],
    }).compile();
    service = module.get<QueryService>(QueryService);
  });

  describe('queryObjects', () => {
    it('should return paginated results for a given object type', async () => {
      const instances = [
        { id: 'i1', objectType: 'customer', externalId: 'C001', label: 'Test', properties: { name: 'Test' }, relationships: {}, createdAt: new Date(), updatedAt: new Date() },
      ];
      prisma.objectInstance.findMany.mockResolvedValue(instances);
      prisma.objectInstance.count.mockResolvedValue(1);

      const result = await service.queryObjects('t1', ['*'], {
        objectType: 'customer',
      });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.objectType).toBe('customer');
      expect(prisma.objectInstance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 't1',
            objectType: 'customer',
          }),
        }),
      );
    });

    it('should apply property filters using JSONB path', async () => {
      prisma.objectInstance.findMany.mockResolvedValue([]);
      prisma.objectInstance.count.mockResolvedValue(0);

      await service.queryObjects('t1', ['*'], {
        objectType: 'customer',
        filters: [{ field: 'region', operator: 'eq', value: '华东' }],
      });

      expect(prisma.objectInstance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              { properties: { path: ['region'], equals: '华东' } },
            ]),
          }),
        }),
      );
    });

    it('should apply search filter on searchText', async () => {
      prisma.objectInstance.findMany.mockResolvedValue([]);
      prisma.objectInstance.count.mockResolvedValue(0);

      await service.queryObjects('t1', ['*'], {
        objectType: 'customer',
        search: '张三',
      });

      expect(prisma.objectInstance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            searchText: { contains: '张三', mode: 'insensitive' },
          }),
        }),
      );
    });

    it('should apply pagination defaults', async () => {
      prisma.objectInstance.findMany.mockResolvedValue([]);
      prisma.objectInstance.count.mockResolvedValue(0);

      const result = await service.queryObjects('t1', ['*'], {
        objectType: 'customer',
      });

      expect(result.meta.page).toBe(1);
      expect(result.meta.pageSize).toBe(20);
      expect(prisma.objectInstance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
        }),
      );
    });

    it('should throw ForbiddenException when user lacks object.read permission', async () => {
      permissionService.assertCanAccess.mockImplementation(() => {
        throw new ForbiddenException();
      });

      await expect(
        service.queryObjects('t1', [], { objectType: 'customer' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should filter fields based on permissions', async () => {
      const instances = [
        { id: 'i1', objectType: 'customer', externalId: 'C001', label: 'Test', properties: { name: 'Test', secret: 'hidden' }, relationships: {}, createdAt: new Date(), updatedAt: new Date() },
      ];
      prisma.objectInstance.findMany.mockResolvedValue(instances);
      prisma.objectInstance.count.mockResolvedValue(1);
      permissionService.filterFields.mockReturnValue({ name: 'Test' });

      const result = await service.queryObjects('t1', ['object.read:name'], {
        objectType: 'customer',
      });

      expect(result.data[0].properties).toEqual({ name: 'Test' });
      expect(permissionService.filterFields).toHaveBeenCalled();
    });

    it('should support sorting by property', async () => {
      prisma.objectInstance.findMany.mockResolvedValue([]);
      prisma.objectInstance.count.mockResolvedValue(0);

      await service.queryObjects('t1', ['*'], {
        objectType: 'customer',
        sort: { field: 'createdAt', direction: 'desc' },
      });

      expect(prisma.objectInstance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        }),
      );
    });
  });
});
