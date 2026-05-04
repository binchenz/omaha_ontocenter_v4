import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@omaha/db';
import { createTestApp, loginAsAdmin } from './test-helpers';

describe('Ontology create/update validation parity (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let prisma: PrismaClient;
  let tenantId: string;

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
      `DELETE FROM object_relationships WHERE tenant_id = $1::uuid AND source_type_id IN (SELECT id FROM object_types WHERE tenant_id = $1::uuid AND name LIKE 'parity_probe%')`,
      tenantId,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM object_types WHERE tenant_id = $1::uuid AND name LIKE 'parity_probe%'`,
      tenantId,
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('create rejects a derived expression referencing an unknown relation', async () => {
    const res = await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'parity_probe_a',
        label: 'Parity A',
        properties: [{ name: 'x', label: 'X', type: 'number' }],
        derivedProperties: [
          {
            name: 'hasGhosts',
            label: 'Has ghosts',
            type: 'boolean',
            expression: 'exists ghosts where x > 0',
          },
        ],
      })
      .expect(400);
    expect(JSON.stringify(res.body)).toMatch(/ghosts/);
  });

  it('create still accepts derived expressions that only touch own properties', async () => {
    const res = await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'parity_probe_b',
        label: 'Parity B',
        properties: [{ name: 'x', label: 'X', type: 'number' }],
        derivedProperties: [
          {
            name: 'isBig',
            label: 'Is big',
            type: 'boolean',
            expression: 'x > 100',
          },
        ],
      })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/ontology/types/${res.body.id}`)
      .set('Authorization', `Bearer ${token}`);
  });
});
