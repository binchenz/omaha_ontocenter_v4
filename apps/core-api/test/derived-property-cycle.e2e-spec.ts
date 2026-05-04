import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@omaha/db';
import { createTestApp, loginAsAdmin } from './test-helpers';

describe('Derived-property cycle detection (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let prisma: PrismaClient;
  let tenantId: string;
  let objectTypeId: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await loginAsAdmin(app);
    prisma = new PrismaClient();

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    tenantId = me.body.tenantId;

    await prisma.$executeRawUnsafe(
      `DELETE FROM object_types WHERE tenant_id = $1::uuid AND name = 'cycle_probe_widget'`,
      tenantId,
    );

    const ot = await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'cycle_probe_widget',
        label: 'Cycle Widget',
        properties: [{ name: 'x', label: 'X', type: 'number' }],
      })
      .expect(201);
    objectTypeId = ot.body.id;
  });

  afterAll(async () => {
    if (objectTypeId) {
      await request(app.getHttpServer())
        .delete(`/ontology/types/${objectTypeId}`)
        .set('Authorization', `Bearer ${token}`);
    }
    await prisma.$disconnect();
    await app.close();
  });

  it('accepts non-cyclic derived-property composition (A → B → x)', async () => {
    await request(app.getHttpServer())
      .put(`/ontology/types/${objectTypeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        derivedProperties: [
          { name: 'b', label: 'B', type: 'boolean', expression: 'x > 0' },
          { name: 'a', label: 'A', type: 'boolean', expression: 'b = true' },
        ],
      })
      .expect(200);
  });

  it('rejects a direct cycle: A depends on B and B depends on A', async () => {
    const res = await request(app.getHttpServer())
      .put(`/ontology/types/${objectTypeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        derivedProperties: [
          { name: 'a', label: 'A', type: 'boolean', expression: 'b = true' },
          { name: 'b', label: 'B', type: 'boolean', expression: 'a = true' },
        ],
      })
      .expect(400);
    expect(JSON.stringify(res.body)).toMatch(/cycle/i);
  });
});
