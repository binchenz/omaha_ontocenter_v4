import { PrismaService } from '@omaha/db';

/**
 * Resolves a runtime setting: the env var takes precedence, falling back to the
 * value persisted by the Setup Wizard in system_settings, then to a dev default.
 *
 * This is the lookup only — callers decide whether to cache the result. Secrets
 * that may be written after boot (e.g. JWT_SECRET on first-run) must NOT cache,
 * so they pick up the wizard-written value without a restart.
 */
export async function resolveSystemSetting(
  prisma: PrismaService,
  key: string,
  fallback: string,
): Promise<string> {
  const fromEnv = process.env[key];
  if (fromEnv) return fromEnv;
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return row?.value ?? fallback;
}
