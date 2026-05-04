import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@omaha/db';
import { createTestApp, loginAsAdmin } from './test-helpers';

describe('Soft-delete (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let prisma: PrismaClient;
  let tenantId: string;
  let liveId: string;
  let deletedId: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await loginAsAdmin(app);
    prisma = new PrismaClient();

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    tenantId = me.body.tenantId;

    const live = await prisma.objectInstance.create({
      data: {
        tenantId,
        objectType: 'softdelete_probe',
        externalId: 'SD-LIVE-1',
        label: 'Live Probe',
        properties: { name: 'live' },
        relationships: {},
      },
    });
    liveId = live.id;

    const del = await prisma.objectInstance.create({
      data: {
        tenantId,
        objectType: 'softdelete_probe',
        externalId: 'SD-DEL-1',
        label: 'Deleted Probe',
        properties: { name: 'deleted' },
        relationships: {},
      },
    });
    deletedId = del.id;

    await prisma.$executeRawUnsafe(
      `UPDATE object_instances SET deleted_at = NOW() WHERE id = $1::uuid`,
      deletedId,
    );
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      `DELETE FROM object_instances WHERE id IN ($1::uuid, $2::uuid)`,
      liveId,
      deletedId,
    );
    await prisma.$disconnect();
    await app.close();
  });

  it('POST /query/objects — excludes soft-deleted rows by default', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({ objectType: 'softdelete_probe' })
      .expect(201);

    const ids = res.body.data.map((r: { id: string }) => r.id);
    expect(ids).toContain(liveId);
    expect(ids).not.toContain(deletedId);
    expect(res.body.meta.total).toBe(1);
  });

  it('internal includeDeleted symbol bypasses the filter for audit replay', async () => {
    const { PrismaService, INCLUDE_DELETED_SYMBOL } = await import('@omaha/db');
    const svc = new PrismaService();

    const all = await svc.objectInstance.findMany({
      where: { tenantId, objectType: 'softdelete_probe' },
      [INCLUDE_DELETED_SYMBOL]: true,
    } as never);
    const ids = all.map((r: { id: string }) => r.id);
    expect(ids).toContain(liveId);
    expect(ids).toContain(deletedId);
    expect(all.length).toBe(2);

    const filtered = await svc.objectInstance.findMany({
      where: { tenantId, objectType: 'softdelete_probe' },
    });
    const filteredIds = filtered.map((r: { id: string }) => r.id);
    expect(filteredIds).toContain(liveId);
    expect(filteredIds).not.toContain(deletedId);

    await svc.$disconnect();
  });
});
