import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, loginAsAdmin } from './test-helpers';

describe('Connector (e2e)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await loginAsAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /connectors — should list connectors', async () => {
    const res = await request(app.getHttpServer())
      .get('/connectors')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.find((c: any) => c.name === 'demo-erp')).toBeDefined();
  });

  it('POST /connectors — should create a new connector', async () => {
    const res = await request(app.getHttpServer())
      .post('/connectors')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'test-mysql',
        type: 'mysql',
        config: { host: 'localhost', port: 3306 },
      })
      .expect(201);

    expect(res.body.name).toBe('test-mysql');
    expect(res.body.status).toBe('inactive');

    await request(app.getHttpServer())
      .delete(`/connectors/${res.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('GET /connectors — should return 401 without token', () => {
    return request(app.getHttpServer())
      .get('/connectors')
      .expect(401);
  });
});
