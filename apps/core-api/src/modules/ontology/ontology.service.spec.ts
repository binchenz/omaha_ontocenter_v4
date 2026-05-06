import { Test, TestingModule } from '@nestjs/testing';
import { OntologyService } from './ontology.service';
import { IndexManagerService } from './index-manager.service';
import { PrismaService } from '@omaha/db';
import { NotFoundException } from '@nestjs/common';

describe('OntologyService', () => {
  let service: OntologyService;
  let prisma: {
    objectType: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    objectRelationship: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      objectType: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      objectRelationship: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OntologyService,
        { provide: PrismaService, useValue: prisma },
        { provide: IndexManagerService, useValue: { reconcile: jest.fn().mockResolvedValue({ created: [], dropped: [], kept: [] }), dropAllFor: jest.fn().mockResolvedValue([]) } },
      ],
    }).compile();
    service = module.get<OntologyService>(OntologyService);
  });

  describe('listObjectTypes', () => {
    it('should return all object types for a tenant', async () => {
      const types = [{ id: 'ot1', name: 'customer', label: 'Customer' }];
      prisma.objectType.findMany.mockResolvedValue(types);
      const result = await service.listObjectTypes('t1');
      expect(result).toEqual(types);
      expect(prisma.objectType.findMany).toHaveBeenCalledWith({
        where: { tenantId: 't1' },
        orderBy: { name: 'asc' },
      });
    });
  });

  describe('getObjectType', () => {
    it('should return object type by id', async () => {
      const ot = { id: 'ot1', tenantId: 't1', name: 'customer' };
      prisma.objectType.findUnique.mockResolvedValue(ot);
      const result = await service.getObjectType('t1', 'ot1');
      expect(result).toEqual(ot);
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.objectType.findUnique.mockResolvedValue(null);
      await expect(service.getObjectType('t1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createObjectType', () => {
    it('should create and return object type', async () => {
      const created = { id: 'ot1', tenantId: 't1', name: 'customer', label: 'Customer', properties: [], derivedProperties: [], version: 1 };
      prisma.objectType.create.mockResolvedValue(created);
      const result = await service.createObjectType('t1', { name: 'customer', label: 'Customer', properties: [] });
      expect(result).toEqual(created);
      expect(prisma.objectType.create).toHaveBeenCalledWith({
        data: { tenantId: 't1', name: 'customer', label: 'Customer', properties: [], derivedProperties: [] },
      });
    });
  });

  describe('updateObjectType', () => {
    it('should update and return object type', async () => {
      const existing = { id: 'ot1', tenantId: 't1', version: 1 };
      prisma.objectType.findUnique.mockResolvedValue(existing);
      const updated = { ...existing, label: 'Updated', version: 2 };
      prisma.objectType.update.mockResolvedValue(updated);
      const result = await service.updateObjectType('t1', 'ot1', { label: 'Updated' });
      expect(result).toEqual(updated);
    });
  });

  describe('deleteObjectType', () => {
    it('should delete object type', async () => {
      const existing = { id: 'ot1', tenantId: 't1' };
      prisma.objectType.findUnique.mockResolvedValue(existing);
      prisma.objectType.delete.mockResolvedValue(existing);
      await service.deleteObjectType('t1', 'ot1');
      expect(prisma.objectType.delete).toHaveBeenCalledWith({ where: { id: 'ot1' } });
    });
  });

  describe('listRelationships', () => {
    it('should return relationships for a tenant', async () => {
      const rels = [{ id: 'r1', name: 'has_orders' }];
      prisma.objectRelationship.findMany.mockResolvedValue(rels);
      const result = await service.listRelationships('t1');
      expect(result).toEqual(rels);
    });
  });

  describe('createRelationship', () => {
    it('should create and return relationship', async () => {
      const created = { id: 'r1', tenantId: 't1', sourceTypeId: 'ot1', targetTypeId: 'ot2', name: 'has_orders', cardinality: 'one-to-many' };
      prisma.objectRelationship.create.mockResolvedValue(created);
      const result = await service.createRelationship('t1', { sourceTypeId: 'ot1', targetTypeId: 'ot2', name: 'has_orders', cardinality: 'one-to-many' });
      expect(result).toEqual(created);
    });
  });

  describe('deleteRelationship', () => {
    it('should delete relationship', async () => {
      const existing = { id: 'r1', tenantId: 't1' };
      prisma.objectRelationship.findUnique.mockResolvedValue(existing);
      prisma.objectRelationship.delete.mockResolvedValue(existing);
      await service.deleteRelationship('t1', 'r1');
      expect(prisma.objectRelationship.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
    });

    it('should throw NotFoundException for cross-tenant relationship', async () => {
      prisma.objectRelationship.findUnique.mockResolvedValue({ id: 'r1', tenantId: 'other-tenant' });
      await expect(service.deleteRelationship('t1', 'r1')).rejects.toThrow(NotFoundException);
    });
  });
});
