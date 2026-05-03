import { Test, TestingModule } from '@nestjs/testing';
import { TenantService } from './tenant.service';
import { PrismaService } from '@omaha/db';

describe('TenantService', () => {
  let service: TenantService;
  let prisma: { tenant: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      tenant: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get<TenantService>(TenantService);
  });

  describe('findById', () => {
    it('should return tenant by id', async () => {
      const tenant = { id: 't1', name: 'Demo', slug: 'demo', settings: {} };
      prisma.tenant.findUnique.mockResolvedValue(tenant);
      const result = await service.findById('t1');
      expect(result).toEqual(tenant);
      expect(prisma.tenant.findUnique).toHaveBeenCalledWith({ where: { id: 't1' } });
    });
  });

  describe('updateSettings', () => {
    it('should update tenant settings', async () => {
      const updated = { id: 't1', name: 'Demo', slug: 'demo', settings: { timezone: 'Asia/Shanghai' } };
      prisma.tenant.update.mockResolvedValue(updated);
      const result = await service.updateSettings('t1', { timezone: 'Asia/Shanghai' });
      expect(result.settings).toEqual({ timezone: 'Asia/Shanghai' });
    });
  });
});
