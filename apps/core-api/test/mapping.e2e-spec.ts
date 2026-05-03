import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Mapping (e2e)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@demo.com', password: 'admin123', tenantSlug: 'demo' });
    token = loginRes.body.accessToken;
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
