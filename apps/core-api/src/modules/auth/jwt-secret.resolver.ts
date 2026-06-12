import { PrismaService } from '@omaha/db';
import { resolveSystemSetting } from '../setup/system-setting.resolver';

/**
 * Resolves the JWT signing secret: env var takes precedence, falling back to the
 * value stored by the Setup Wizard in system_settings. Intentionally uncached —
 * on a fresh boot the secret is written by the wizard after the resolver may have
 * first run, so each call re-reads to self-heal without a restart.
 */
export function resolveJwtSecret(prisma: PrismaService): Promise<string> {
  return resolveSystemSetting(prisma, 'JWT_SECRET', 'dev-secret');
}
