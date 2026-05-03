import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, loginAsAdmin } from './test-helpers';

describe('Ontology (e2e)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await loginAsAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /ontology/types — should list object types', async () => {
    const res = await request(app.getHttpServer())
      .get('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(3);
    expect(res.body.find((t: any) => t.name === 'customer')).toBeDefined();
  });

  it('POST /ontology/types — should create a new object type', async () => {
    const res = await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'supplier',
        label: '供应商',
        properties: [{ name: 'name', label: '名称', type: 'string', required: true }],
      })
      .expect(201);

    expect(res.body.name).toBe('supplier');
    expect(res.body.id).toBeDefined();

    await request(app.getHttpServer())
      .delete(`/ontology/types/${res.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('GET /ontology/relationships — should list relationships', async () => {
    const res = await request(app.getHttpServer())
      .get('/ontology/relationships')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  it('GET /ontology/types — should return 401 without token', () => {
    return request(app.getHttpServer())
      .get('/ontology/types')
      .expect(401);
  });
});
