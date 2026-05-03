import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo' },
    update: {},
    create: {
      name: 'Demo Company',
      slug: 'demo',
      settings: { timezone: 'Asia/Shanghai', language: 'zh-CN' },
    },
  });

  const adminRole = await prisma.role.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'admin' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'admin',
      permissions: ['*'],
    },
  });

  const opsRole = await prisma.role.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'operator' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'operator',
      permissions: ['object.read', 'object.query', 'action.preview'],
    },
  });

  const passwordHash = await bcrypt.hash('admin123', 10);

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@demo.com' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'admin@demo.com',
      name: 'Admin',
      passwordHash,
      roleId: adminRole.id,
    },
  });

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'ops@demo.com' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'ops@demo.com',
      name: 'Operator',
      passwordHash,
      roleId: opsRole.id,
    },
  });

  console.log('Seed complete: tenant=%s, admin=%s', tenant.slug, 'admin@demo.com');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
