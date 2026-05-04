import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@omaha/db';
import { createTestApp } from './test-helpers';

describe('Permission DSL + audit (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let salesToken: string;
  let adminUserId: string;
  let salesUserId: string;
  let prisma: PrismaClient;
  let tenantId: string;
  let orderTypeId: string;
  let salesRoleId: string;
  const seededIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaClient();

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@demo.com', password: 'admin123', tenantSlug: 'demo' });
    adminToken = adminLogin.body.accessToken;

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    tenantId = me.body.tenantId;
    adminUserId = me.body.id;

    await prisma.$executeRawUnsafe(
      `DELETE FROM object_instances WHERE tenant_id = $1::uuid AND object_type = 'perm_probe_order'`,
      tenantId,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM object_types WHERE tenant_id = $1::uuid AND name = 'perm_probe_order'`,
      tenantId,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM users WHERE email = 'sales-perm@demo.com'`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM roles WHERE name = 'sales-perm'`,
    );

    const salesRole = await prisma.role.create({
      data: {
        tenantId,
        name: 'sales-perm',
        permissions: [
          {
            permission: 'object.read',
            condition: 'salesOwnerId = :userId',
          },
        ] as never,
      },
    });
    salesRoleId = salesRole.id;

    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash('secret123', 10);
    const sales = await prisma.user.create({
      data: {
        tenantId,
        email: 'sales-perm@demo.com',
        name: 'Sales Person',
        passwordHash: hash,
        roleId: salesRoleId,
      },
    });
    salesUserId = sales.id;

    const salesLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'sales-perm@demo.com', password: 'secret123', tenantSlug: 'demo' });
    salesToken = salesLogin.body.accessToken;

    orderTypeId = (
      await request(app.getHttpServer())
        .post('/ontology/types')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'perm_probe_order',
          label: 'Perm Order',
          properties: [
            { name: 'salesOwnerId', label: 'Sales Owner', type: 'string' },
            { name: 'totalAmount', label: 'Total', type: 'number' },
          ],
        })
        .expect(201)
    ).body.id;

    for (const [ext, owner] of [
      ['PERM-O-1', salesUserId],
      ['PERM-O-2', salesUserId],
      ['PERM-O-3', adminUserId],
      ['PERM-O-4', adminUserId],
    ] as const) {
      const row = await prisma.objectInstance.create({
        data: {
          tenantId,
          objectType: 'perm_probe_order',
          externalId: ext,
          label: ext,
          properties: { salesOwnerId: owner, totalAmount: 100 },
          relationships: {},
        },
      });
      seededIds.push(row.id);
    }
  });

  afterAll(async () => {
    for (const id of seededIds) {
      await prisma.$executeRawUnsafe(`DELETE FROM object_instances WHERE id = $1::uuid`, id);
    }
    if (orderTypeId) {
      await request(app.getHttpServer())
        .delete(`/ontology/types/${orderTypeId}`)
        .set('Authorization', `Bearer ${adminToken}`);
    }
    if (salesUserId) {
      await prisma.$executeRawUnsafe(`DELETE FROM audit_logs WHERE actor_id = $1::uuid`, salesUserId);
      await prisma.$executeRawUnsafe(`DELETE FROM users WHERE id = $1::uuid`, salesUserId);
    }
    if (salesRoleId) {
      await prisma.$executeRawUnsafe(`DELETE FROM roles WHERE id = $1::uuid`, salesRoleId);
    }
    await prisma.$disconnect();
    await app.close();
  });

  it("sales user's query is automatically scoped to their own orders", async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ objectType: 'perm_probe_order' })
      .expect(201);

    const ids = res.body.data.map((r: { externalId: string }) => r.externalId).sort();
    expect(ids).toEqual(['PERM-O-1', 'PERM-O-2']);
    expect(res.body.meta.total).toBe(2);
  });

  it('audit_log records the effective_permission_filter with the actor id substituted', async () => {
    await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ objectType: 'perm_probe_order' })
      .expect(201);

    const rows = await prisma.$queryRawUnsafe<{ effective_permission_filter: unknown; compiled_sql_hash: string }[]>(
      `SELECT effective_permission_filter, compiled_sql_hash
       FROM audit_logs
       WHERE actor_id = $1::uuid AND object_type = 'perm_probe_order'
       ORDER BY created_at DESC LIMIT 1`,
      salesUserId,
    );
    expect(rows.length).toBe(1);
    const filter = rows[0].effective_permission_filter as string;
    expect(filter).toContain(salesUserId);
    expect(filter).not.toContain(':userId');
    expect(rows[0].compiled_sql_hash).toMatch(/^[a-f0-9]{16,}$/);
  });

  it('admin user without a permission condition sees all rows', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ objectType: 'perm_probe_order' })
      .expect(201);

    const ids = res.body.data.map((r: { externalId: string }) => r.externalId).sort();
    expect(ids).toEqual(['PERM-O-1', 'PERM-O-2', 'PERM-O-3', 'PERM-O-4']);
  });
});
