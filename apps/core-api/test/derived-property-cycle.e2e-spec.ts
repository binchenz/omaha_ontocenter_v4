import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureTestTenant, cleanupTestTenant, loginAsTestTenantAdmin } from './test-helpers';

describe('Derived-property cycle detection (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let objectTypeId: string;

  beforeAll(async () => {
    app = await createTestApp();
    await ensureTestTenant(app);
    await cleanupTestTenant(app); // clear any leftovers from a crashed prior run before seeding
    token = await loginAsTestTenantAdmin(app);

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
    await cleanupTestTenant(app);
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
