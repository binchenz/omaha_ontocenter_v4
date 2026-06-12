import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '@omaha/db';
import { CurrentUser } from '@omaha/shared-types';
import { AppModule } from '../src/app.module';
import { ViewManagerService } from '../src/modules/ontology/view-manager.service';

export async function createTestApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}

export async function loginAsAdmin(app: INestApplication): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email: 'admin@demo.com', password: 'admin123', tenantSlug: 'demo' });
  return res.body.accessToken;
}

export async function loginAsOperator(app: INestApplication): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email: 'ops@demo.com', password: 'admin123', tenantSlug: 'demo' });
  return res.body.accessToken;
}

export const TEST_TENANT_SLUG = 'tenant_test';
export const TEST_TENANT_ADMIN_EMAIL = 'admin@tenant-test.local';
export const TEST_TENANT_ADMIN_PASSWORD = 'test123';
// Query-only operator: object.read/query + action.preview, no write/design capabilities.
// Mirrors the demo `operator` role so write-authz can prove writes are denied.
export const TEST_TENANT_OPERATOR_EMAIL = 'operator@tenant-test.local';
export const TEST_TENANT_OPERATOR_PASSWORD = 'test123';
const TEST_TENANT_OPERATOR_PERMS = ['object.read', 'object.query', 'action.preview'];

export async function ensureTestTenant(app: INestApplication): Promise<string> {
  const prisma = app.get(PrismaService);
  let tenant = await prisma.tenant.findUnique({ where: { slug: TEST_TENANT_SLUG } });
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: { slug: TEST_TENANT_SLUG, name: 'Tenant Test (e2e)' },
    });
    const adminRole = await prisma.role.create({
      data: { tenantId: tenant.id, name: 'admin', permissions: ['*'] },
    });
    await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: TEST_TENANT_ADMIN_EMAIL,
        name: 'Test Admin',
        passwordHash: await bcrypt.hash(TEST_TENANT_ADMIN_PASSWORD, 10),
        roleId: adminRole.id,
      },
    });
  }
  // Operator is provisioned idempotently — also covers a tenant_test left over from a
  // prior run that predates the operator (roles/users survive cleanupTestTenant).
  await ensureTestTenantOperator(app, tenant.id);
  return tenant.id;
}

/** Idempotently provision the query-only operator role + user on tenant_test. */
async function ensureTestTenantOperator(app: INestApplication, tenantId: string): Promise<void> {
  const prisma = app.get(PrismaService);
  const operatorRole = await prisma.role.upsert({
    where: { tenantId_name: { tenantId, name: 'operator' } },
    update: { permissions: TEST_TENANT_OPERATOR_PERMS },
    create: { tenantId, name: 'operator', permissions: TEST_TENANT_OPERATOR_PERMS },
  });
  await prisma.user.upsert({
    where: { tenantId_email: { tenantId, email: TEST_TENANT_OPERATOR_EMAIL } },
    update: {},
    create: {
      tenantId,
      email: TEST_TENANT_OPERATOR_EMAIL,
      name: 'Test Operator',
      passwordHash: await bcrypt.hash(TEST_TENANT_OPERATOR_PASSWORD, 10),
      roleId: operatorRole.id,
    },
  });
}

export async function loginAsTestTenantAdmin(app: INestApplication): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({
      email: TEST_TENANT_ADMIN_EMAIL,
      password: TEST_TENANT_ADMIN_PASSWORD,
      tenantSlug: TEST_TENANT_SLUG,
    });
  return res.body.accessToken;
}

export async function loginAsTestTenantOperator(app: INestApplication): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({
      email: TEST_TENANT_OPERATOR_EMAIL,
      password: TEST_TENANT_OPERATOR_PASSWORD,
      tenantSlug: TEST_TENANT_SLUG,
    });
  return res.body.accessToken;
}

/** Build a CurrentUser actor from a tenant_test user's email — for the Agent SDK path. */
export async function getTestTenantActor(app: INestApplication, email: string): Promise<CurrentUser> {
  const prisma = app.get(PrismaService);
  const u = await prisma.user.findFirst({ where: { email }, include: { role: true } });
  if (!u) throw new Error(`getTestTenantActor: user ${email} not found — call ensureTestTenant first`);
  const perms = (u.role.permissions as unknown as string[]) ?? [];
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    tenantId: u.tenantId,
    roleId: u.roleId,
    roleName: u.role.name,
    permissions: perms,
    permissionRules: perms.map((p) => ({ permission: p })),
  };
}

export async function cleanupTestTenant(app: INestApplication): Promise<void> {
  const prisma = app.get(PrismaService);
  const tenant = await prisma.tenant.findUnique({ where: { slug: TEST_TENANT_SLUG } });
  if (!tenant) return;
  await prisma.conversationTurn.deleteMany({ where: { conversation: { tenantId: tenant.id } } });
  await prisma.conversation.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.objectInstance.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.objectRelationship.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.objectType.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.connector.deleteMany({ where: { tenantId: tenant.id } });
  // Object-type rows are gone, but their materialized views are separate DB objects that
  // deleting the rows does NOT drop — they orphan and accumulate (unbounded for specs that
  // mint uniquely-named types, e.g. write-authz). ViewManagerService owns the matview naming,
  // so it owns the by-prefix teardown too.
  await app.get(ViewManagerService).dropAllForTenant(tenant.id);
}

export interface SseEvent {
  type: string;
  [key: string]: unknown;
}

export async function postSse(
  app: INestApplication,
  pathname: string,
  body: unknown,
  token: string,
  timeoutMs = 90_000,
): Promise<SseEvent[]> {
  const server = app.getHttpServer();
  const address = server.listening ? server.address() : await new Promise<any>(r => {
    server.listen(0, () => r(server.address()));
  });
  const port = typeof address === 'object' ? address.port : 0;

  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.body) return [];

  const events: SseEvent[] = [];
  const decoder = new TextDecoder();
  let buffer = '';
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        events.push(JSON.parse(line.slice(6)));
      } catch {}
    }
  }
  return events;
}

export async function runWithRetry<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (firstErr) {
    // eslint-disable-next-line no-console
    console.warn(`[e2e] scenario "${name}" failed once, retrying:`, (firstErr as Error)?.message);
    return await fn();
  }
}
