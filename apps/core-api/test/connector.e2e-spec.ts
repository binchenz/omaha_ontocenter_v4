import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Connector (e2e)', () => {
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

    // Cleanup
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
