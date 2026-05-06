import { PrismaClient } from '@omaha/db';
import * as bcrypt from 'bcrypt';

export interface TenantBootstrapResult {
  tenantId: string;
  tenantSlug: string;
  adminEmail: string;
  adminCreated: boolean;
  initialPassword?: string;
}

export interface TenantBootstrapInput {
  prisma: PrismaClient;
  slug: string;
  name: string;
  adminEmail: string;
  generatePassword: () => string;
}

export async function bootstrapTenant(input: TenantBootstrapInput): Promise<TenantBootstrapResult> {
  const { prisma, slug, name, adminEmail, generatePassword } = input;

  const tenant = await prisma.tenant.upsert({
    where: { slug },
    update: {},
    create: { slug, name, settings: { timezone: 'Asia/Shanghai', language: 'zh-CN' } },
  });

  const adminRole = await prisma.role.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'admin' } },
    update: {},
    create: { tenantId: tenant.id, name: 'admin', permissions: ['*'] },
  });

  const existingUser = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email: adminEmail } },
  });
  if (existingUser) {
    return { tenantId: tenant.id, tenantSlug: tenant.slug, adminEmail, adminCreated: false };
  }

  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: adminEmail,
      name: 'Admin',
      passwordHash,
      roleId: adminRole.id,
    },
  });
  return {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    adminEmail,
    adminCreated: true,
    initialPassword: password,
  };
}
