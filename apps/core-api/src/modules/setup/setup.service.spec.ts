import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { SetupService } from './setup.service';
import { PrismaService } from '@omaha/db';

function makeHarness() {
  const prisma = {
    tenant: { count: jest.fn(), create: jest.fn() },
    role: { create: jest.fn() },
    user: { create: jest.fn() },
    systemSetting: { upsert: jest.fn() },
  };
  return { prisma };
}

async function buildService(prisma: any) {
  const mod = await Test.createTestingModule({
    providers: [SetupService, { provide: PrismaService, useValue: prisma }],
  }).compile();
  return mod.get(SetupService);
}

describe('SetupService', () => {
  describe('isInitialized', () => {
    it('returns false when no tenants exist', async () => {
      const { prisma } = makeHarness();
      prisma.tenant.count.mockResolvedValue(0);
      const svc = await buildService(prisma);
      expect(await svc.isInitialized()).toBe(false);
    });

    it('returns true when a tenant exists', async () => {
      const { prisma } = makeHarness();
      prisma.tenant.count.mockResolvedValue(1);
      const svc = await buildService(prisma);
      expect(await svc.isInitialized()).toBe(true);
    });
  });

  describe('getStatus', () => {
    it('returns { initialized: false } when no tenants', async () => {
      const { prisma } = makeHarness();
      prisma.tenant.count.mockResolvedValue(0);
      const svc = await buildService(prisma);
      expect(await svc.getStatus()).toEqual({ initialized: false });
    });

    it('returns { initialized: true, slug } when tenant exists', async () => {
      const { prisma } = makeHarness();
      prisma.tenant.count.mockResolvedValue(1);
      (prisma.tenant as any).findFirst = jest.fn().mockResolvedValue({ slug: 'acme' });
      const svc = await buildService(prisma);
      expect(await svc.getStatus()).toEqual({ initialized: true, slug: 'acme' });
    });
  });

  describe('initialize', () => {
    it('throws ConflictException if already initialized', async () => {
      const { prisma } = makeHarness();
      prisma.tenant.count.mockResolvedValue(1);
      const svc = await buildService(prisma);
      await expect(
        svc.initialize({ tenantName: 'Acme', adminEmail: 'a@b.com', adminPassword: 'pass123', apiKey: 'key' }),
      ).rejects.toThrow(ConflictException);
    });

    it('creates Tenant, admin Role, operator Role, and admin User on first call', async () => {
      const { prisma } = makeHarness();
      prisma.tenant.count.mockResolvedValue(0);
      prisma.tenant.create.mockResolvedValue({ id: 't1', slug: 'acme' });
      prisma.role.create
        .mockResolvedValueOnce({ id: 'r-admin' })
        .mockResolvedValueOnce({ id: 'r-operator' });
      prisma.user.create.mockResolvedValue({ id: 'u1' });
      const svc = await buildService(prisma);
      await svc.initialize({ tenantName: 'Acme', adminEmail: 'a@b.com', adminPassword: 'pass123', apiKey: 'key' });
      expect(prisma.tenant.create).toHaveBeenCalledTimes(1);
      expect(prisma.role.create).toHaveBeenCalledTimes(2);
      expect(prisma.user.create).toHaveBeenCalledTimes(1);
      // Regression: the read path enforces `object.read`, so the operator role MUST
      // include it — granting only `object.query` 403s every data query (chunmi, 2026-06-19).
      const operatorCreate = prisma.role.create.mock.calls
        .map((c: any[]) => c[0].data)
        .find((d: any) => d.name === 'operator');
      expect(operatorCreate.permissions).toContain('object.read');
      expect(prisma.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { key: 'DEEPSEEK_API_KEY' } }),
      );
    });

    it('generates and persists JWT_SECRET and CONNECTOR_ENCRYPTION_KEY', async () => {
      const { prisma } = makeHarness();
      prisma.tenant.count.mockResolvedValue(0);
      prisma.tenant.create.mockResolvedValue({ id: 't1', slug: 'acme' });
      prisma.role.create
        .mockResolvedValueOnce({ id: 'r-admin' })
        .mockResolvedValueOnce({ id: 'r-operator' });
      prisma.user.create.mockResolvedValue({ id: 'u1' });
      const svc = await buildService(prisma);
      await svc.initialize({ tenantName: 'Acme', adminEmail: 'a@b.com', adminPassword: 'pass123', apiKey: 'key' });

      const upsertedKeys = prisma.systemSetting.upsert.mock.calls.map((c: any[]) => c[0].where.key);
      expect(upsertedKeys).toEqual(expect.arrayContaining(['JWT_SECRET', 'CONNECTOR_ENCRYPTION_KEY']));

      const secretCall = prisma.systemSetting.upsert.mock.calls.find((c: any[]) => c[0].where.key === 'JWT_SECRET');
      const keyCall = prisma.systemSetting.upsert.mock.calls.find((c: any[]) => c[0].where.key === 'CONNECTOR_ENCRYPTION_KEY');
      // Random, non-empty, and not the public placeholder secrets.
      expect(secretCall[0].create.value).toMatch(/^[0-9a-f]{128}$/);
      expect(keyCall[0].create.value).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('testLlm', () => {
    it('returns { ok: true } on successful fetch', async () => {
      const { prisma } = makeHarness();
      const svc = await buildService(prisma);
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: { content: 'pong' } }] }),
      }) as any;
      const result = await svc.testLlm('valid-key');
      expect(result.ok).toBe(true);
    });

    it('returns { ok: false, error } on failed fetch', async () => {
      const { prisma } = makeHarness();
      const svc = await buildService(prisma);
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: { message: 'Unauthorized' } }),
      }) as any;
      const result = await svc.testLlm('bad-key');
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
