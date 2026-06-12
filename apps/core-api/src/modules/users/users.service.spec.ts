import { Test } from '@nestjs/testing';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '@omaha/db';

function makeHarness() {
  const prisma = {
    user: {
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
  };
  return { prisma };
}

async function buildService(prisma: any) {
  const mod = await Test.createTestingModule({
    providers: [UsersService, { provide: PrismaService, useValue: prisma }],
  }).compile();
  return mod.get(UsersService);
}

describe('UsersService', () => {
  it('listUsers returns users for the tenant', async () => {
    const { prisma } = makeHarness();
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', name: 'Alice', email: 'a@b.com', roleId: 'r1', role: { name: 'admin' } },
    ]);
    const svc = await buildService(prisma);
    const result = await svc.listUsers('t1');
    expect(result).toHaveLength(1);
    expect(result[0].email).toBe('a@b.com');
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 't1' } }));
  });

  it('createUser hashes password and returns dto without passwordHash', async () => {
    const { prisma } = makeHarness();
    prisma.user.create.mockResolvedValue({ id: 'u1', name: 'Bob', email: 'b@c.com', roleId: 'r1', role: { name: 'operator' } });
    const svc = await buildService(prisma);
    const result = await svc.createUser('t1', { name: 'Bob', email: 'b@c.com', password: 'pass123', roleId: 'r1' });
    expect(result).not.toHaveProperty('passwordHash');
    const createCall = prisma.user.create.mock.calls[0][0];
    expect(createCall.data.passwordHash).toBeDefined();
    expect(createCall.data.passwordHash).not.toBe('pass123');
  });

  it('createUser throws ConflictException on duplicate email', async () => {
    const { prisma } = makeHarness();
    prisma.user.create.mockRejectedValue({ code: 'P2002' });
    const svc = await buildService(prisma);
    await expect(svc.createUser('t1', { name: 'Bob', email: 'b@c.com', password: 'pass123', roleId: 'r1' }))
      .rejects.toThrow(ConflictException);
  });

  it('deleteUser deletes the user', async () => {
    const { prisma } = makeHarness();
    prisma.user.delete.mockResolvedValue({});
    const svc = await buildService(prisma);
    await svc.deleteUser('t1', 'u2', 'u1');
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'u2' } });
  });

  it('deleteUser throws BadRequestException when deleting self', async () => {
    const { prisma } = makeHarness();
    const svc = await buildService(prisma);
    await expect(svc.deleteUser('t1', 'u1', 'u1')).rejects.toThrow(BadRequestException);
  });
});
