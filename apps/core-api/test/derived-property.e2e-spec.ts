import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@omaha/db';
import { createTestApp, loginAsAdmin } from './test-helpers';

describe('Derived Property v1 — isHighValue (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let prisma: PrismaClient;
  let tenantId: string;
  let objectTypeId: string;
  const seededIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    token = await loginAsAdmin(app);
    prisma = new PrismaClient();

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    tenantId = me.body.tenantId;

    const ot = await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'dsl_probe_order',
        label: 'DSL Probe Order',
        properties: [
          { name: 'totalAmount', label: 'Total', type: 'number', filterable: true },
        ],
        derivedProperties: [
          {
            name: 'isHighValue',
            label: 'Is High Value',
            type: 'boolean',
            expression: 'totalAmount >= 1000',
          },
        ],
      })
      .expect(201);
    objectTypeId = ot.body.id;

    for (const [ext, amount] of [
      ['DSL-O-1', 500],
      ['DSL-O-2', 999],
      ['DSL-O-3', 1000],
      ['DSL-O-4', 2500],
    ] as const) {
      const row = await prisma.objectInstance.create({
        data: {
          tenantId,
          objectType: 'dsl_probe_order',
          externalId: ext,
          label: ext,
          properties: { totalAmount: amount },
          relationships: {},
        },
      });
      seededIds.push(row.id);
    }
  });

  afterAll(async () => {
    for (const id of seededIds) {
      await prisma.$executeRawUnsafe(`DELETE FROM object_instances WHERE id = $1::uuid`, id);
    }
    if (objectTypeId) {
      await request(app.getHttpServer())
        .delete(`/ontology/types/${objectTypeId}`)
        .set('Authorization', `Bearer ${token}`);
    }
    await prisma.$disconnect();
    await app.close();
  });

  it('rejects an ObjectType whose derived expression references an unknown identifier', async () => {
    const res = await request(app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'dsl_probe_bad',
        label: 'DSL Probe Bad',
        properties: [{ name: 'x', label: 'X', type: 'number' }],
        derivedProperties: [
          {
            name: 'bogus',
            label: 'Bogus',
            type: 'boolean',
            expression: 'nonexistent >= 0',
          },
        ],
      })
      .expect(400);
    expect(JSON.stringify(res.body)).toMatch(/nonexistent/i);
  });

  it('POST /query/objects — filters by the derived property isHighValue = true', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'dsl_probe_order',
        filters: [{ derivedProperty: 'isHighValue', operator: 'eq', value: true }],
      })
      .expect(201);

    const externalIds = res.body.data.map((r: { externalId: string }) => r.externalId).sort();
    expect(externalIds).toEqual(['DSL-O-3', 'DSL-O-4']);
    expect(res.body.meta.total).toBe(2);
  });

  it('POST /query/objects — filters by the derived property isHighValue = false', async () => {
    const res = await request(app.getHttpServer())
      .post('/query/objects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        objectType: 'dsl_probe_order',
        filters: [{ derivedProperty: 'isHighValue', operator: 'eq', value: false }],
      })
      .expect(201);

    const externalIds = res.body.data.map((r: { externalId: string }) => r.externalId).sort();
    expect(externalIds).toEqual(['DSL-O-1', 'DSL-O-2']);
  });
});
