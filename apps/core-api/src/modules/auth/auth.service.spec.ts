import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '@omaha/db';
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: { tenant: { findUnique: jest.Mock }; user: { findUnique: jest.Mock } };
  let jwtService: { sign: jest.Mock };

  beforeEach(async () => {
    prisma = {
      tenant: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
    };
    jwtService = { sign: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('login', () => {
    it('should throw UnauthorizedException when tenant not found', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);
      await expect(
        service.login({ email: 'a@b.com', password: 'pass123', tenantSlug: 'bad' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when user not found', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1' });
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.login({ email: 'a@b.com', password: 'pass123', tenantSlug: 'demo' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when password is wrong', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1' });
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1', email: 'a@b.com', name: 'Test', tenantId: 't1', roleId: 'r1',
        passwordHash: await bcrypt.hash('correct', 10),
        role: { name: 'admin', permissions: [] },
      });
      await expect(
        service.login({ email: 'a@b.com', password: 'wrong', tenantSlug: 'demo' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should return token and user on valid credentials', async () => {
      const hash = await bcrypt.hash('pass123', 10);
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1' });
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1', email: 'a@b.com', name: 'Test', tenantId: 't1', roleId: 'r1',
        passwordHash: hash,
        role: { name: 'admin', permissions: ['*'] },
      });
      jwtService.sign.mockReturnValue('jwt-token');

      const result = await service.login({ email: 'a@b.com', password: 'pass123', tenantSlug: 'demo' });
      expect(result.accessToken).toBe('jwt-token');
      expect(result.user.email).toBe('a@b.com');
      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: 'u1', email: 'a@b.com', tenantId: 't1', roleId: 'r1',
      });
    });
  });
});
