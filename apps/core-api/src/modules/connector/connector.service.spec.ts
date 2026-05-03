import { Test, TestingModule } from '@nestjs/testing';
import { ConnectorService } from './connector.service';
import { PrismaService } from '@omaha/db';
import { NotFoundException } from '@nestjs/common';

describe('ConnectorService', () => {
  let service: ConnectorService;
  let prisma: {
    connector: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      connector: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectorService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get<ConnectorService>(ConnectorService);
  });

  describe('listConnectors', () => {
    it('should return all connectors for a tenant', async () => {
      const connectors = [{ id: 'c1', name: 'erp-db', type: 'postgresql' }];
      prisma.connector.findMany.mockResolvedValue(connectors);
      const result = await service.listConnectors('t1');
      expect(result).toEqual(connectors);
      expect(prisma.connector.findMany).toHaveBeenCalledWith({
        where: { tenantId: 't1' },
        orderBy: { name: 'asc' },
      });
    });
  });

  describe('getConnector', () => {
    it('should return connector by id', async () => {
      const conn = { id: 'c1', tenantId: 't1', name: 'erp-db' };
      prisma.connector.findUnique.mockResolvedValue(conn);
      const result = await service.getConnector('t1', 'c1');
      expect(result).toEqual(conn);
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.connector.findUnique.mockResolvedValue(null);
      await expect(service.getConnector('t1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createConnector', () => {
    it('should create and return connector', async () => {
      const created = { id: 'c1', tenantId: 't1', name: 'erp-db', type: 'postgresql', config: { host: 'localhost' }, status: 'inactive' };
      prisma.connector.create.mockResolvedValue(created);
      const result = await service.createConnector('t1', { name: 'erp-db', type: 'postgresql', config: { host: 'localhost' } });
      expect(result).toEqual(created);
    });
  });

  describe('updateConnector', () => {
    it('should update and return connector', async () => {
      const existing = { id: 'c1', tenantId: 't1' };
      prisma.connector.findUnique.mockResolvedValue(existing);
      const updated = { ...existing, name: 'erp-db-v2' };
      prisma.connector.update.mockResolvedValue(updated);
      const result = await service.updateConnector('t1', 'c1', { name: 'erp-db-v2' });
      expect(result).toEqual(updated);
    });
  });

  describe('deleteConnector', () => {
    it('should delete connector', async () => {
      const existing = { id: 'c1', tenantId: 't1' };
      prisma.connector.findUnique.mockResolvedValue(existing);
      prisma.connector.delete.mockResolvedValue(existing);
      await service.deleteConnector('t1', 'c1');
      expect(prisma.connector.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    });
  });
});
