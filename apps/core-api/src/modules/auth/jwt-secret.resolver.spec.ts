import { resolveJwtSecret } from './jwt-secret.resolver';

function makePrisma(stored: string | null) {
  return {
    systemSetting: {
      findUnique: jest.fn().mockResolvedValue(stored === null ? null : { value: stored }),
    },
  } as any;
}

describe('resolveJwtSecret', () => {
  const ORIGINAL = process.env.JWT_SECRET;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = ORIGINAL;
  });

  it('prefers the env var when set, without touching the database', async () => {
    process.env.JWT_SECRET = 'env-secret';
    const prisma = makePrisma('db-secret');
    expect(await resolveJwtSecret(prisma)).toBe('env-secret');
    expect(prisma.systemSetting.findUnique).not.toHaveBeenCalled();
  });

  it('falls back to the Setup-Wizard value in system_settings when env is unset', async () => {
    delete process.env.JWT_SECRET;
    const prisma = makePrisma('wizard-generated-secret');
    expect(await resolveJwtSecret(prisma)).toBe('wizard-generated-secret');
    expect(prisma.systemSetting.findUnique).toHaveBeenCalledWith({ where: { key: 'JWT_SECRET' } });
  });

  it('falls back to dev-secret when neither env nor system_settings has a value', async () => {
    delete process.env.JWT_SECRET;
    const prisma = makePrisma(null);
    expect(await resolveJwtSecret(prisma)).toBe('dev-secret');
  });
});
