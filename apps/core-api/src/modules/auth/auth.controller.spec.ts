import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: { login: jest.Mock };

  beforeEach(async () => {
    authService = { login: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();
    controller = module.get<AuthController>(AuthController);
  });

  it('should call authService.login and return result', async () => {
    const expected = { accessToken: 'tok', user: { id: '1', email: 'a@b.com', name: 'T', tenantId: 't1', role: 'admin' } };
    authService.login.mockResolvedValue(expected);
    const result = await controller.login({ email: 'a@b.com', password: 'pass123', tenantSlug: 'demo' });
    expect(result).toEqual(expected);
  });

  it('should return current user from /auth/me', () => {
    const user = { id: '1', email: 'a@b.com', name: 'T', tenantId: 't1', roleId: 'r1', roleName: 'admin', permissions: ['*'] };
    const result = controller.me(user as any);
    expect(result).toEqual(user);
  });
});
