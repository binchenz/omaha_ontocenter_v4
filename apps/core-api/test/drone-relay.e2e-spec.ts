import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@omaha/db';
import { createTestApp, postSse, runWithRetry, SseEvent } from './test-helpers';
import { ViewManagerService } from '../src/modules/ontology/view-manager.service';
import { objectTypes, relationships, DRONE_RELAY_TENANT_SLUG } from './drone-relay-ontology';
import { generateData } from './drone-relay-data';
import * as bcrypt from 'bcrypt';

const ADMIN_EMAIL = 'admin@drone-relay.local';
const ADMIN_PASSWORD = 'relay2026';

describe('Drone-Rider Relay (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;
  let tenantId: string;
  let typeIds: Map<string, string>;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaClient();

    // Bootstrap tenant
    let tenant = await prisma.tenant.findUnique({ where: { slug: DRONE_RELAY_TENANT_SLUG } });
    if (!tenant) {
      tenant = await prisma.tenant.create({ data: { slug: DRONE_RELAY_TENANT_SLUG, name: '无人机接力配送测试' } });
    }
    tenantId = tenant.id;

    // Ensure admin user
    const existingUser = await prisma.user.findFirst({ where: { tenantId, email: ADMIN_EMAIL } });
    if (!existingUser) {
      let role = await prisma.role.findFirst({ where: { tenantId, name: 'admin' } });
      if (!role) {
        role = await prisma.role.create({ data: { tenantId, name: 'admin', permissions: ['*'] } });
      }
      await prisma.user.create({
        data: {
          tenantId,
          email: ADMIN_EMAIL,
          name: 'Relay Admin',
          passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10),
          roleId: role.id,
        },
      });
    }

    // Login
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, tenantSlug: DRONE_RELAY_TENANT_SLUG });
    token = loginRes.body.accessToken;

    // Clean existing data
    for (const t of objectTypes) {
      await prisma.objectInstance.deleteMany({ where: { tenantId, objectType: t.name } });
    }
    await prisma.objectRelationship.deleteMany({ where: { tenantId } });
    await prisma.objectType.deleteMany({ where: { tenantId } });

    // Create object types via API
    typeIds = new Map();
    for (const spec of objectTypes) {
      const res = await request(app.getHttpServer())
        .post('/ontology/types')
        .set('Authorization', `Bearer ${token}`)
        .send(spec)
        .expect(201);
      typeIds.set(spec.name, res.body.id);
    }

    // Create relationships via API
    for (const rel of relationships) {
      await request(app.getHttpServer())
        .post('/ontology/relationships')
        .set('Authorization', `Bearer ${token}`)
        .send({
          sourceTypeId: typeIds.get(rel.sourceName),
          targetTypeId: typeIds.get(rel.targetName),
          name: rel.name,
          cardinality: rel.cardinality,
        })
        .expect(201);
    }

    // Generate and insert data in batches
    const data = generateData(tenantId);
    const allEntities = [
      ...data.merchants,
      ...data.customers,
      ...data.relayStations,
      ...data.drones,
      ...data.riders,
    ];
    await prisma.objectInstance.createMany({ data: allEntities });

    // Orders in batches of 1000
    for (let i = 0; i < data.deliveryOrders.length; i += 1000) {
      await prisma.objectInstance.createMany({ data: data.deliveryOrders.slice(i, i + 1000) });
    }

    // Legs in batches of 1000
    for (let i = 0; i < data.deliveryLegs.length; i += 1000) {
      await prisma.objectInstance.createMany({ data: data.deliveryLegs.slice(i, i + 1000) });
    }

    // Refresh materialized views
    const viewManager = app.get(ViewManagerService);
    await Promise.all(objectTypes.map(t => viewManager.refresh(tenantId, t.name).catch(() => {})));
  }, 300_000);

  afterAll(async () => {
    if (!prisma) return;
    if (tenantId) {
      for (const t of objectTypes) {
        await prisma.objectInstance.deleteMany({ where: { tenantId, objectType: t.name } });
      }
      await prisma.objectRelationship.deleteMany({ where: { tenantId } });
      await prisma.objectType.deleteMany({ where: { tenantId } });
    }
    await prisma.$disconnect();
    if (app) await app.close();
  }, 60_000);

  describe('ontology setup verification', () => {
    it('created 7 object types', async () => {
      const res = await request(app.getHttpServer())
        .get('/ontology/types')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.length).toBe(7);
    });

    it('created 4 relationships', async () => {
      const res = await request(app.getHttpServer())
        .get('/ontology/relationships')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.length).toBe(4);
    });
  });

  describe('efficiency comparison', () => {
    it('avg totalTime grouped by deliveryMode', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/aggregate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'delivery_order',
          groupBy: ['deliveryMode'],
          metrics: [
            { kind: 'avg', field: 'totalTime', alias: 'avgTime' },
            { kind: 'count', alias: 'n' },
          ],
        })
        .expect(201);
      expect(res.body.groups).toHaveLength(2);
      const byMode = Object.fromEntries(
        res.body.groups.map((g: any) => [g.key.deliveryMode, g.metrics]),
      );
      expect(byMode.relay).toBeDefined();
      expect(byMode.rider_only).toBeDefined();
      expect(Number(byMode.relay.n)).toBe(3000);
      expect(Number(byMode.rider_only.n)).toBe(2000);
    });

    it('distance > 5km: relay is faster than rider_only', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/aggregate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'delivery_order',
          filters: [{ field: 'totalDistance', operator: 'gt', value: 5 }],
          groupBy: ['deliveryMode'],
          metrics: [{ kind: 'avg', field: 'totalTime', alias: 'avgTime' }],
        })
        .expect(201);
      const byMode = Object.fromEntries(
        res.body.groups.map((g: any) => [g.key.deliveryMode, Number(g.metrics.avgTime)]),
      );
      expect(byMode.relay).toBeLessThan(byMode.rider_only);
    });

    it('distance < 3km: rider_only is faster than relay', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/aggregate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'delivery_order',
          filters: [{ field: 'totalDistance', operator: 'lt', value: 3 }],
          groupBy: ['deliveryMode'],
          metrics: [{ kind: 'avg', field: 'totalTime', alias: 'avgTime' }],
        })
        .expect(201);
      const byMode = Object.fromEntries(
        res.body.groups.map((g: any) => [g.key.deliveryMode, Number(g.metrics.avgTime)]),
      );
      expect(byMode.rider_only).toBeLessThan(byMode.relay);
    });
  });

  describe('resource scheduling', () => {
    it('filters pending orders', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/objects')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'delivery_order',
          filters: [{ field: 'status', operator: 'eq', value: 'pending' }],
          pageSize: 1,
        })
        .expect(201);
      expect(res.body.meta.total).toBeGreaterThan(0);
    });

    it('filters idle riders', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/objects')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'rider',
          filters: [{ field: 'status', operator: 'eq', value: 'idle' }],
        })
        .expect(201);
      expect(res.body.meta.total).toBeGreaterThan(0);
    });

    it('aggregates order count per station', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/aggregate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'delivery_leg',
          filters: [{ field: 'legType', operator: 'eq', value: 'drone' }],
          groupBy: ['stationName'],
          metrics: [{ kind: 'count', alias: 'n' }],
          orderBy: [{ kind: 'metric', by: 'n', direction: 'desc' }],
          maxGroups: 5,
        })
        .expect(201);
      expect(res.body.groups.length).toBeGreaterThan(0);
      expect(res.body.groups[0].key.stationName).toBeDefined();
    });
  });

  describe('bottleneck analysis', () => {
    it('station-05 has highest avg waitTime', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/aggregate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'delivery_leg',
          filters: [{ field: 'legType', operator: 'eq', value: 'drone' }],
          groupBy: ['stationName'],
          metrics: [{ kind: 'avg', field: 'waitTime', alias: 'avgWait' }],
          orderBy: [{ kind: 'metric', by: 'avgWait', direction: 'desc' }],
          maxGroups: 1,
        })
        .expect(201);
      expect(res.body.groups[0].key.stationName).toBe('station-05');
    });

    it('UAV-01 has highest delivery count', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/aggregate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'delivery_leg',
          filters: [{ field: 'legType', operator: 'eq', value: 'drone' }],
          groupBy: ['carrier'],
          metrics: [{ kind: 'count', alias: 'trips' }],
          orderBy: [{ kind: 'metric', by: 'trips', direction: 'desc' }],
          maxGroups: 1,
        })
        .expect(201);
      expect(res.body.groups[0].key.carrier).toBe('UAV-01');
    });

    it('filters overtime orders (totalTime > 40 min)', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/aggregate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          objectType: 'delivery_order',
          filters: [{ field: 'totalTime', operator: 'gt', value: 40 }],
          metrics: [{ kind: 'count', alias: 'overtime_count' }],
        })
        .expect(201);
      expect(Number(res.body.groups[0].metrics.overtime_count)).toBeGreaterThan(0);
    });
  });

  describe('Agent natural language queries', () => {
    const askAgent = async (message: string): Promise<SseEvent[]> => {
      return runWithRetry(message, () =>
        postSse(app, '/agent/chat', { message }, token, 60_000),
      );
    };

    const expectValidAgentResponse = (events: SseEvent[]) => {
      const types = events.map(e => e.type);
      expect(types).toContain('tool_call');
      expect(types).toContain('tool_result');
      expect(types.includes('text') || types.includes('done')).toBe(true);
      expect(types).not.toContain('error');
    };

    it('Q1: 接力模式 vs 纯骑手平均配送时间', async () => {
      const events = await askAgent('接力模式和纯骑手模式的平均配送时间分别是多少？');
      expectValidAgentResponse(events);
    }, 60_000);

    it('Q2: 5公里以上哪种模式更快', async () => {
      const events = await askAgent('距离超过5公里的订单，接力模式和纯骑手模式哪个更快？');
      expectValidAgentResponse(events);
    }, 60_000);

    it('Q3: 按距离段对比两种模式耗时', async () => {
      const events = await askAgent('按总距离分段（小于3公里、3到5公里、5到10公里、10公里以上），对比接力和纯骑手的平均耗时');
      expectValidAgentResponse(events);
    }, 60_000);

    it('Q4: 某中转站附近待配送订单数', async () => {
      const events = await askAgent('station-05中转站处理的待配送订单有多少？');
      expectValidAgentResponse(events);
    }, 60_000);

    it('Q5: 空闲骑手', async () => {
      const events = await askAgent('当前有多少骑手处于空闲状态？');
      expectValidAgentResponse(events);
    }, 60_000);

    it('Q6: 各中转站处理量', async () => {
      const events = await askAgent('每个中转站处理了多少无人机配送段？列出前5名');
      expectValidAgentResponse(events);
    }, 60_000);

    it('Q7: 等待时间最长的中转站', async () => {
      const events = await askAgent('哪个中转站的平均等待时间最长？');
      expectValidAgentResponse(events);
    }, 60_000);

    it('Q8: 无人机利用率排名', async () => {
      const events = await askAgent('哪台无人机承担的配送次数最多？');
      expectValidAgentResponse(events);
    }, 60_000);

    it('Q9: 超时订单', async () => {
      const events = await askAgent('总耗时超过40分钟的订单有多少？');
      expectValidAgentResponse(events);
    }, 60_000);
  });
});
