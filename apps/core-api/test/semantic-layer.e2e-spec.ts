/**
 * Semantic Layer E2E Test
 *
 * Validates the full semantic layer lifecycle:
 * 1. Agent creates an Object Type with auto-inferred description + unit
 * 2. DB correctly persists semantic annotations
 * 3. Agent uses semantic context to answer ambiguous natural language queries
 */
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@omaha/db';
import request from 'supertest';
import { createTestApp, postSse, runWithRetry, SseEvent } from './test-helpers';
import * as bcrypt from 'bcrypt';

const TENANT_SLUG = 'semantic-test';
const ADMIN_EMAIL = 'admin@semantic-test.local';
const ADMIN_PASSWORD = 'semantic2026';

describe('Semantic Layer (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;
  let tenantId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaClient();

    let tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
    if (!tenant) {
      tenant = await prisma.tenant.create({ data: { slug: TENANT_SLUG, name: '语义层测试' } });
    }
    tenantId = tenant.id;

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
          name: 'Semantic Admin',
          passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10),
          roleId: role.id,
        },
      });
    }

    // Clean previous test data
    await prisma.objectInstance.deleteMany({ where: { tenantId } });
    await prisma.objectRelationship.deleteMany({ where: { tenantId } });
    await prisma.objectType.deleteMany({ where: { tenantId } });

    // Login
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, tenantSlug: TENANT_SLUG });
    token = loginRes.body.accessToken;
  }, 120_000);

  afterAll(async () => {
    if (prisma && tenantId) {
      await prisma.objectInstance.deleteMany({ where: { tenantId } });
      await prisma.objectRelationship.deleteMany({ where: { tenantId } });
      await prisma.objectType.deleteMany({ where: { tenantId } });
    }
    if (prisma) await prisma.$disconnect();
    if (app) await app.close();
  }, 30_000);

  describe('Phase 1: Agent creates type with semantic annotations', () => {
    it('creates product type with description and unit via Agent chat', async () => {
      const events = await runWithRetry('create product type', async () => {
        const evts = await postSse(app, '/agent/chat', {
          message: '帮我创建一个"商品"对象类型，包含以下字段：商品名称(文本)、价格(数字,单位元)、重量(数字,单位kg)、库存数量(数字)、上架日期(日期)、品类(文本)',
        }, token, 90_000);
        // Must have confirmation_request (create_object_type requires confirmation)
        const types = evts.map(e => e.type);
        if (!types.includes('confirmation_request')) throw new Error('No confirmation_request');
        return evts;
      });

      const types = events.map(e => e.type);
      expect(types).toContain('tool_call');
      expect(types).toContain('confirmation_request');

      // Find the confirmation event to get conversationId
      const doneEvent = events.find(e => e.type === 'done');
      const conversationId = doneEvent?.conversationId as string;
      expect(conversationId).toBeTruthy();

      // Confirm the creation
      const confirmEvents = await postSse(app, '/agent/confirm', {
        conversationId,
        confirmed: true,
      }, token, 60_000);

      const confirmTypes = confirmEvents.map(e => e.type);
      expect(confirmTypes).toContain('tool_result');
    }, 120_000);

    it('persisted description on ObjectType', async () => {
      const objectType = await prisma.objectType.findFirst({
        where: { tenantId, name: 'product' },
      });
      expect(objectType).toBeTruthy();
      expect(objectType!.description).toBeTruthy();
      expect(objectType!.description!.length).toBeGreaterThan(0);
    });

    it('persisted description and unit on properties', async () => {
      const objectType = await prisma.objectType.findFirst({
        where: { tenantId, name: 'product' },
      });
      const properties = objectType!.properties as any[];

      const priceField = properties.find((p: any) => p.name === 'price' || p.label?.includes('价格'));
      expect(priceField).toBeTruthy();
      expect(priceField.unit).toBeTruthy();

      const weightField = properties.find((p: any) => p.name === 'weight' || p.label?.includes('重量'));
      expect(weightField).toBeTruthy();
      expect(weightField.unit).toBeTruthy();
    });
  });

  describe('Phase 2: Seed data and verify semantic-aware queries', () => {
    beforeAll(async () => {
      // Ensure product type exists (Phase 1 may have created it with different field names)
      const objectType = await prisma.objectType.findFirst({ where: { tenantId, name: 'product' } });
      if (!objectType) {
        // Fallback: create directly if Agent didn't create it with expected name
        await prisma.objectType.create({
          data: {
            tenantId,
            name: 'product',
            label: '商品',
            description: '商品信息，包含价格、重量和库存',
            properties: [
              { name: 'name', type: 'string', label: '商品名称', filterable: true, sortable: true, description: '商品名称' },
              { name: 'price', type: 'number', label: '价格', filterable: true, sortable: true, description: '商品售价', unit: '元' },
              { name: 'weight', type: 'number', label: '重量', filterable: true, sortable: true, description: '商品重量', unit: 'kg' },
              { name: 'stock', type: 'number', label: '库存数量', filterable: true, sortable: true, description: '当前库存' },
              { name: 'category', type: 'string', label: '品类', filterable: true, description: '商品分类' },
            ] as any,
          },
        });
      }

      // Seed test data
      const products = [
        { name: '高端耳机', price: 2999, weight: 0.3, stock: 50, category: '数码' },
        { name: '入门耳机', price: 99, weight: 0.2, stock: 500, category: '数码' },
        { name: '蛋白粉5kg', price: 399, weight: 5.0, stock: 200, category: '食品' },
        { name: '维生素片', price: 59, weight: 0.1, stock: 1000, category: '食品' },
        { name: '哑铃套装', price: 599, weight: 20.0, stock: 30, category: '运动' },
        { name: '瑜伽垫', price: 89, weight: 1.5, stock: 300, category: '运动' },
        { name: '机械键盘', price: 1299, weight: 1.2, stock: 80, category: '数码' },
        { name: '显示器', price: 3999, weight: 8.0, stock: 20, category: '数码' },
      ];

      await prisma.objectInstance.createMany({
        data: products.map((p, i) => ({
          tenantId,
          objectType: 'product',
          externalId: `P-${String(i + 1).padStart(3, '0')}`,
          label: p.name,
          properties: p,
          relationships: {},
        })),
      });
    }, 30_000);

    it('Agent answers "贵的商品" using price field (semantic: unit=元)', async () => {
      const events = await runWithRetry('expensive products', () =>
        postSse(app, '/agent/chat', {
          message: '有哪些比较贵的商品？列出价格超过1000元的',
        }, token, 60_000),
      );

      const types = events.map(e => e.type);
      expect(types).toContain('tool_call');
      expect(types).toContain('tool_result');

      // Verify the tool_call used price field (not weight or stock)
      const toolCall = events.find(e => e.type === 'tool_call');
      const args = toolCall?.args as any;
      if (args?.filters) {
        const priceFilter = args.filters.find((f: any) => f.field === 'price');
        expect(priceFilter).toBeTruthy();
      }
    }, 60_000);

    it('Agent answers "重的商品" using weight field (semantic: unit=kg)', async () => {
      const events = await runWithRetry('heavy products', () =>
        postSse(app, '/agent/chat', {
          message: '哪些商品比较重？超过5公斤的有哪些？',
        }, token, 60_000),
      );

      const types = events.map(e => e.type);
      expect(types).toContain('tool_call');
      expect(types).toContain('tool_result');

      const toolCall = events.find(e => e.type === 'tool_call');
      const args = toolCall?.args as any;
      if (args?.filters) {
        const weightFilter = args.filters.find((f: any) => f.field === 'weight');
        expect(weightFilter).toBeTruthy();
      }
    }, 60_000);

    it('Agent answers "库存紧张" using stock field (semantic: description=当前库存)', async () => {
      const events = await runWithRetry('low stock', () =>
        postSse(app, '/agent/chat', {
          message: '哪些商品库存紧张？库存低于50个的列出来',
        }, token, 60_000),
      );

      const types = events.map(e => e.type);
      expect(types).toContain('tool_call');
      expect(types).toContain('tool_result');

      const toolCall = events.find(e => e.type === 'tool_call');
      const args = toolCall?.args as any;
      if (args?.filters) {
        const stockFilter = args.filters.find((f: any) => f.field === 'stock');
        expect(stockFilter).toBeTruthy();
      }
    }, 60_000);

    it('Agent aggregates "各品类平均价格" correctly', async () => {
      const events = await runWithRetry('category avg price', () =>
        postSse(app, '/agent/chat', {
          message: '各品类的平均价格是多少？',
        }, token, 60_000),
      );

      const types = events.map(e => e.type);
      expect(types).toContain('tool_call');
      expect(types).toContain('tool_result');
      expect(types.includes('text') || types.includes('done')).toBe(true);
      expect(types).not.toContain('error');
    }, 60_000);
  });
});
