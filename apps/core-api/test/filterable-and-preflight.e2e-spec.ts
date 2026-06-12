import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureTestTenant, cleanupTestTenant, loginAsTestTenantAdmin } from './test-helpers';

describe('Filterable enforcement + derived-property preflight (e2e)', () => {
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
        name: 'flag_probe_widget',
        label: 'Flag Probe Widget',
        properties: [
          { name: 'sku', label: 'SKU', type: 'string', filterable: true, sortable: true },
          { name: 'color', label: 'Color', type: 'string' },
        ],
      })
      .expect(201);
    objectTypeId = ot.body.id;
  });

  afterAll(async () => {
    await cleanupTestTenant(app);
    await app.close();
  });

  it('filters on a flagged property succeed', async () => {
    await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'flag_probe_widget',
        filters: [{ field: 'sku', operator: 'eq', value: 'X' }],
      })
      .expect(201);
  });

  it('filters on an unflagged property are rejected with PROPERTY_NOT_FILTERABLE', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'flag_probe_widget',
        filters: [{ field: 'color', operator: 'eq', value: 'red' }],
      })
      .expect(400);
    expect(JSON.stringify(res.body)).toMatch(/PROPERTY_NOT_FILTERABLE/);
    expect(JSON.stringify(res.body)).toMatch(/color/);
  });

  it('sort on an unflagged property silently falls back and meta.sortFallbackReason is populated', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'flag_probe_widget',
        sort: { field: 'color', direction: 'asc' },
      })
      .expect(201);
    expect(res.body.meta.sortFallbackReason).toMatch(/color/);
  });

  it('preflight endpoint validates a derived expression and returns dependencies', async () => {
    const res = await request(app.getHttpServer())
      .post(`/ontology/types/${objectTypeId}/derived-properties/validate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expression: "sku = 'A' or color = 'red'" })
      .expect(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.dependencies).toContain('sku');
    expect(res.body.dependencies).toContain('color');
    expect(res.body.errors).toEqual([]);
  });

  it('preflight endpoint returns errors for an invalid expression', async () => {
    const res = await request(app.getHttpServer())
      .post(`/ontology/types/${objectTypeId}/derived-properties/validate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expression: 'mystery = 1' })
      .expect(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.errors[0]).toMatch(/mystery/i);
  });
});
