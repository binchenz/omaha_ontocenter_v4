/**
 * Query timeout e2e — verifies that SET LOCAL statement_timeout is applied
 * and that PostgreSQL query_canceled (57014) is caught and returned as
 * a structured QUERY_TIMEOUT error.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@omaha/db';
import { createTestApp, loginAsAdmin } from './test-helpers';

describe('query statement_timeout (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let prisma: PrismaClient;

  beforeAll(async () => {
    app = await createTestApp();
    token = await loginAsAdmin(app);
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('normal queries within timeout', () => {
    it('queryObjects succeeds under default timeout', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/objects')
        .set('Authorization', `Bearer ${token}`)
        .send({ objectType: 'order', page: 1, pageSize: 5 })
        .expect(201);

      expect(res.body.data).toBeDefined();
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('aggregateObjects succeeds under default timeout', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/aggregate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'order',
          metrics: [{ kind: 'count', alias: 'n' }],
        })
        .expect(201);

      expect(res.body.groups).toBeDefined();
    });
  });

  describe('timeout mechanism verification', () => {
    it('SET LOCAL statement_timeout cancels a slow query (pg_sleep)', async () => {
      // Directly verify the timeout mechanism at the DB level:
      // SET LOCAL statement_timeout = 100ms, then run pg_sleep(1) which sleeps 1 second.
      // PostgreSQL should cancel it with error code 57014.
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '100ms'`);
          await tx.$queryRawUnsafe(`SELECT pg_sleep(1)`);
        }),
      ).rejects.toThrow(/canceling statement due to statement timeout/);
    });

    it('SET LOCAL does not affect queries outside the transaction', async () => {
      // After the above transaction rolls back, a normal query should work fine.
      const result = await prisma.$queryRawUnsafe<{ one: number }[]>(`SELECT 1 AS one`);
      expect(Number(result[0].one)).toBe(1);
    });
  });

  describe('QUERY_TIMEOUT error via HTTP endpoint', () => {
    const originalTimeout = process.env.QUERY_TIMEOUT_MS;

    beforeAll(() => {
      // Use 1ms — on most systems the permission resolution + planning overhead
      // means the actual SQL execution will start after the timeout window.
      // If the query is too fast, we fall back to verifying the mechanism above.
      process.env.QUERY_TIMEOUT_MS = '1';
    });

    afterAll(() => {
      if (originalTimeout !== undefined) {
        process.env.QUERY_TIMEOUT_MS = originalTimeout;
      } else {
        delete process.env.QUERY_TIMEOUT_MS;
      }
    });

    it('queryObjects returns QUERY_TIMEOUT when timeout is triggered', async () => {
      // Retry several times — with 1ms timeout, the query may occasionally
      // complete before PostgreSQL's timer fires.
      let gotTimeout = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        const res = await request(app.getHttpServer())
          .post('/query/objects')
          .set('Authorization', `Bearer ${token}`)
          .send({ objectType: 'order', page: 1, pageSize: 100 });

        if (res.status === 400) {
          expect(res.body.error?.code ?? res.body.code).toBe('QUERY_TIMEOUT');
          expect(res.body.error?.hint ?? res.body.hint).toBeDefined();
          gotTimeout = true;
          break;
        }
      }
      expect(gotTimeout).toBe(true);
    });

    it('aggregateObjects returns QUERY_TIMEOUT when timeout is triggered', async () => {
      let gotTimeout = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        const res = await request(app.getHttpServer())
          .post('/query/aggregate')
          .set('Authorization', `Bearer ${token}`)
          .send({
            objectType: 'order',
            groupBy: ['status'],
            metrics: [
              { kind: 'count', alias: 'n' },
              { kind: 'sum', field: 'totalAmount', alias: 'total' },
              { kind: 'avg', field: 'totalAmount', alias: 'avg' },
            ],
          });

        if (res.status === 400) {
          expect(res.body.error?.code ?? res.body.code).toBe('QUERY_TIMEOUT');
          expect(res.body.error?.hint ?? res.body.hint).toBeDefined();
          gotTimeout = true;
          break;
        }
      }
      expect(gotTimeout).toBe(true);
    });
  });
});
