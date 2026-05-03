import { Test, TestingModule } from '@nestjs/testing';
import { MappingService } from './mapping.service';
import { PrismaService } from '@omaha/db';
import { NotFoundException } from '@nestjs/common';

describe('MappingService', () => {
  let service: MappingService;
  let prisma: {
    objectMapping: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      objectMapping: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MappingService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get<MappingService>(MappingService);
  });

  describe('listMappings', () => {
    it('should return all mappings for a tenant', async () => {
      const mappings = [{ id: 'm1', tableName: 'customers' }];
      prisma.objectMapping.findMany.mockResolvedValue(mappings);
      const result = await service.listMappings('t1');
      expect(result).toEqual(mappings);
      expect(prisma.objectMapping.findMany).toHaveBeenCalledWith({
        where: { tenantId: 't1' },
        include: { objectType: true, connector: true },
      });
    });
  });

  describe('getMapping', () => {
    it('should return mapping by id', async () => {
      const mapping = { id: 'm1', tenantId: 't1', tableName: 'customers' };
      prisma.objectMapping.findUnique.mockResolvedValue(mapping);
      const result = await service.getMapping('t1', 'm1');
      expect(result).toEqual(mapping);
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.objectMapping.findUnique.mockResolvedValue(null);
      await expect(service.getMapping('t1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createMapping', () => {
    it('should create and return mapping', async () => {
      const created = { id: 'm1', tenantId: 't1', objectTypeId: 'ot1', connectorId: 'c1', tableName: 'customers', propertyMappings: {}, relationshipMappings: {} };
      prisma.objectMapping.create.mockResolvedValue(created);
      const result = await service.createMapping('t1', { objectTypeId: 'ot1', connectorId: 'c1', tableName: 'customers', propertyMappings: {} });
      expect(result).toEqual(created);
    });
  });

  describe('deleteMapping', () => {
    it('should delete mapping', async () => {
      const existing = { id: 'm1', tenantId: 't1' };
      prisma.objectMapping.findUnique.mockResolvedValue(existing);
      prisma.objectMapping.delete.mockResolvedValue(existing);
      await service.deleteMapping('t1', 'm1');
      expect(prisma.objectMapping.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
    });
  });
});
