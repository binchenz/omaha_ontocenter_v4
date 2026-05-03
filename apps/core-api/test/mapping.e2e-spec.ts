import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, loginAsAdmin } from './test-helpers';

describe('Mapping (e2e)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await loginAsAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /mappings — should list mappings', async () => {
    const res = await request(app.getHttpServer())
      .get('/mappings')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].objectType).toBeDefined();
    expect(res.body[0].connector).toBeDefined();
  });

  it('GET /mappings — should return 401 without token', () => {
    return request(app.getHttpServer())
      .get('/mappings')
      .expect(401);
  });
});
