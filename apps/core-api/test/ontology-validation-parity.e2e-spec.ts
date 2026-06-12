import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureTestTenant, cleanupTestTenant, loginAsTestTenantAdmin } from './test-helpers';

describe('Ontology create/update validation parity (e2e)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    await ensureTestTenant(app);
    await cleanupTestTenant(app); // clear any leftovers from a crashed prior run before seeding
    token = await loginAsTestTenantAdmin(app);
  });

  afterAll(async () => {
    await cleanupTestTenant(app);
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
