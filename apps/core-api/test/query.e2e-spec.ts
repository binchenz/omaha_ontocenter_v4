import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, loginAsAdmin, loginAsOperator } from './test-helpers';

describe('Query (e2e)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await loginAsAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /query/objects — should return customers', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({ objectType: 'customer' })
      .expect(201);

    expect(res.body.data).toBeDefined();
    expect(res.body.data.length).toBeGreaterThanOrEqual(3);
    expect(res.body.meta.objectType).toBe('customer');
    expect(res.body.meta.total).toBeGreaterThanOrEqual(3);
    expect(res.body.data[0].properties.name).toBeDefined();
  });

  it('POST /query/objects — should filter by property', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'customer',
        filters: [{ field: 'region', operator: 'eq', value: '华东' }],
      })
      .expect(201);

    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    for (const item of res.body.data) {
      expect(item.properties.region).toBe('华东');
    }
  });

  it('POST /query/objects — should search by text', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'customer',
        search: '张三',
      })
      .expect(201);

    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('POST /query/objects — should paginate results', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'customer',
        page: 1,
        pageSize: 2,
      })
      .expect(201);

    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.pageSize).toBe(2);
    expect(res.body.meta.totalPages).toBeGreaterThanOrEqual(1);
  });

  it('POST /query/objects — should query orders', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({ objectType: 'order' })
      .expect(201);

    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    expect(res.body.data[0].properties.orderNo).toBeDefined();
  });

  it('POST /query/objects — should return empty for unknown type', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({ objectType: 'nonexistent' })
      .expect(201);

    expect(res.body.data).toEqual([]);
    expect(res.body.meta.total).toBe(0);
  });

  it('POST /query/objects — should return 401 without token', () => {
    return request(app.getHttpServer())
      .post('/query/objects')
      .send({ objectType: 'customer' })
      .expect(401);
  });

  it('POST /query/objects — should return 400 without objectType', () => {
    return request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);
  });

  describe('Operator role', () => {
    let opsToken: string;

    beforeAll(async () => {
      opsToken = await loginAsOperator(app);
    });

    it('POST /query/objects — operator should be able to query objects', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/objects')
        .set('Authorization', `Bearer ${opsToken}`)
        .send({ objectType: 'customer' })
        .expect(201);

      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });
});
