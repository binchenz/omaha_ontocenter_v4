/**
 * Example usage of OntologyTestCase interface for 2 scenarios:
 *   1. DERIVED-001: Add derived field + backfill (ADR-0059 lesson)
 *   2. DIM-001: Add dimension constraint (ADR-0057 pattern)
 *
 * These demonstrate the full setup → execute → verify flow in concrete terms.
 */

import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@omaha/db';
import request from 'supertest';
import {
  OntologyTestCase,
  SetupContext,
  SetupResult,
  ExecuteContext,
  ExecuteResult,
  VerifyContext,
  TestVerdict,
  OntologyGroundTruth,
  verifyFieldExists,
  verifyFieldBackfilled,
  verifyDimensionConstraint,
} from './ontology-test-case';
import { createTestApp } from './test-helpers';
import * as bcrypt from 'bcrypt';

// ──────────────────────────────────────────────────────────────────────────────
// Scenario 1: DERIVED-001 — Add derived field (year) to existing ObjectType
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Reproduces ADR-0059's finding: adding a derived field to an EXISTING tenant requires:
 *   1. POST /ontology/types (updates ObjectType.properties)
 *   2. Backfill existing instances
 *   3. Refresh matview (else Agent can't see the field)
 *
 * This test seeds a product ObjectType with instances, then adds a "year" derived field
 * and verifies all three layers are correct.
 */
export const DERIVED_FIELD_001: OntologyTestCase = {
  id: 'DERIVED-001',
  title: 'Add derived field to existing ObjectType with data',
  category: 'derived-field',
  track: 'schema',

  async setup(ctx: SetupContext): Promise<SetupResult> {
    const slug = `ontology-test-${Date.now()}`;
    const { tenantId, token } = await ctx.provisionTenant(slug, 'Test Tenant');

    // Seed a product ObjectType with a date field (no year yet)
    await request(ctx.app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'product',
        label: '产品',
        properties: [
          { name: 'name', label: '名称', type: 'string' },
          { name: 'releaseDate', label: '发布日期', type: 'string' }, // e.g. "2024-01-15"
          { name: 'price', label: '价格', type: 'number', unit: '元' },
        ],
      })
      .expect(201);

    // Seed 3 instances
    const instanceIds: string[] = [];
    for (const data of [
      { name: 'Widget A', releaseDate: '2023-06-01', price: 100 },
      { name: 'Widget B', releaseDate: '2024-03-15', price: 200 },
      { name: 'Widget C', releaseDate: '2024-11-20', price: 150 },
    ]) {
      const res = await request(ctx.app.getHttpServer())
        .post('/objects/product')
        .set('Authorization', `Bearer ${token}`)
        .send({ properties: data })
        .expect(201);
      instanceIds.push(res.body.id);
    }

    return {
      tenantId,
      token,
      anchors: { instanceIds, objectType: 'product' },
    };
  },

  async execute(ctx: ExecuteContext): Promise<ExecuteResult> {
    // Add the derived "year" field (formula: extract year from releaseDate)
    await request(ctx.app.getHttpServer())
      .patch('/ontology/types/product')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({
        properties: [
          { name: 'name', label: '名称', type: 'string' },
          { name: 'releaseDate', label: '发布日期', type: 'string' },
          { name: 'price', label: '价格', type: 'number', unit: '元' },
          { name: 'year', label: '年份', type: 'number', formula: 'YEAR(releaseDate)' }, // NEW
        ],
      })
      .expect(200);

    // Backfill the year field (in real impl, this would call a backfill service)
    // For test purposes, manually update instances:
    const instances = await ctx.prisma.objectInstance.findMany({
      where: { tenantId: ctx.tenantId, objectType: 'product', deletedAt: null },
    });
    for (const inst of instances) {
      const props = inst.properties as Record<string, any>;
      const releaseDate = props.releaseDate as string;
      const year = releaseDate ? parseInt(releaseDate.split('-')[0], 10) : null;
      await ctx.prisma.objectInstance.update({
        where: { id: inst.id },
        data: { properties: { ...props, year } },
      });
    }

    // Refresh matview (ADR-0059 critical step)
    await ctx.prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_product"`);

    return { objectTypeId: 'product' };
  },

  async verify(ctx: VerifyContext): Promise<TestVerdict> {
    const gt = new OntologyGroundTruth(ctx.prisma);

    // Layer 1: Schema exists
    const schemaVerdict = await verifyFieldExists({
      gt,
      tenantId: ctx.tenantId,
      objectType: 'product',
      fieldName: 'year',
      expectedType: 'number',
    });

    // Layer 2: Data backfilled
    const backfillVerdict = await verifyFieldBackfilled({
      gt,
      tenantId: ctx.tenantId,
      objectType: 'product',
      fieldName: 'year',
    });

    // Layer 3: Matview has column (already checked in verifyFieldExists)
    // Layer 4 (not in this test): Agent can query the field — would need /agent/chat call

    const pass = schemaVerdict.pass && backfillVerdict.pass;
    const detail = pass
      ? '✅ 派生字段添加完整：schema + backfill + matview 三层均正确'
      : `❌ 派生字段问题：schema=${schemaVerdict.pass ? '✅' : '❌'}, backfill=${backfillVerdict.pass ? '✅' : '❌'}`;

    return {
      pass,
      detail,
      layers: {
        schema: schemaVerdict,
        backfill: backfillVerdict,
      },
    };
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// Scenario 2: DIM-001 — Add dimension constraint (required + default)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Tests ADR-0057's dimension constraint pattern: a dimension can be required=true
 * with a defaultValue. The QueryPlanner enforces this — queries without the dim
 * auto-apply the default.
 *
 * This test adds a "region" dimension (defaultValue="全国") to a sales ObjectType
 * and verifies the constraint is stored correctly.
 */
export const DIMENSION_CONSTRAINT_001: OntologyTestCase = {
  id: 'DIM-001',
  title: 'Add dimension with required=true + defaultValue',
  category: 'dimension-constraint',
  track: 'schema',

  async setup(ctx: SetupContext): Promise<SetupResult> {
    const slug = `ontology-test-${Date.now()}`;
    const { tenantId, token } = await ctx.provisionTenant(slug, 'Test Tenant');

    // Seed a sales ObjectType (no dimensions yet)
    await request(ctx.app.getHttpServer())
      .post('/ontology/types')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'sales',
        label: '销售记录',
        properties: [
          { name: 'product', label: '产品', type: 'string' },
          { name: 'amount', label: '金额', type: 'number', unit: '元' },
          { name: 'month', label: '月份', type: 'string' }, // e.g. "2024-06"
        ],
      })
      .expect(201);

    return { tenantId, token, anchors: {} };
  },

  async execute(ctx: ExecuteContext): Promise<ExecuteResult> {
    // Add "region" dimension with required=true, defaultValue="全国"
    await request(ctx.app.getHttpServer())
      .patch('/ontology/types/sales')
      .set('Authorization', `Bearer ${ctx.token}`)
      .send({
        properties: [
          { name: 'product', label: '产品', type: 'string' },
          { name: 'amount', label: '金额', type: 'number', unit: '元' },
          { name: 'month', label: '月份', type: 'string' },
          {
            name: 'region',
            label: '区域',
            type: 'string',
            required: true,
            defaultValue: '全国',
            allowedValues: ['全国', '华东', '华北', '华南', '西南'],
          },
        ],
      })
      .expect(200);

    return { objectTypeId: 'sales' };
  },

  async verify(ctx: VerifyContext): Promise<TestVerdict> {
    const gt = new OntologyGroundTruth(ctx.prisma);

    // Verify the constraint is stored correctly
    const verdict = await verifyDimensionConstraint({
      gt,
      tenantId: ctx.tenantId,
      objectType: 'sales',
      dimName: 'region',
      expectedRequired: true,
      expectedDefault: '全国',
    });

    return {
      pass: verdict.pass,
      detail: verdict.pass
        ? '✅ 维度约束正确：required=true, defaultValue=全国'
        : `❌ 维度约束问题：${verdict.detail}`,
      layers: { constraint: verdict },
    };
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// Jest Integration Example
// ──────────────────────────────────────────────────────────────────────────────

/**
 * How to wire these into Jest:
 */
describe('Ontology Test Cases (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  // Helper to provision ephemeral tenant (reused across tests)
  async function provisionTenant(slug: string, name: string) {
    await prisma.tenant.deleteMany({ where: { slug } });
    const tenant = await prisma.tenant.create({ data: { slug, name } });
    const adminRole = await prisma.role.create({
      data: { tenantId: tenant.id, name: 'admin', permissions: ['*'] },
    });
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `admin@${slug}.test`,
        name: 'Admin',
        passwordHash: await bcrypt.hash('test123', 10),
        roleId: adminRole.id,
      },
    });

    // Login to get token
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: 'test123', tenantSlug: slug })
      .expect(201);

    return { tenantId: tenant.id, token: res.body.accessToken };
  }

  // Cleanup helper (deletes ephemeral tenant after test)
  async function cleanupTenant(tenantId: string) {
    await prisma.objectInstance.deleteMany({ where: { tenantId } });
    await prisma.objectType.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.role.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
  }

  describe('DERIVED-001: Add derived field', () => {
    it('adds year field, backfills data, refreshes matview', async () => {
      const testCase = DERIVED_FIELD_001;

      // Setup
      const setupResult = await testCase.setup({ app, prisma, provisionTenant });

      // Execute
      const executeResult = await testCase.execute({ ...setupResult, app, prisma });

      // Verify
      const verdict = await testCase.verify({ ...executeResult, ...setupResult, prisma, groundTruth: new OntologyGroundTruth(prisma) });

      // Cleanup
      await cleanupTenant(setupResult.tenantId);

      // Assert
      expect(verdict.pass).toBe(true);
      expect(verdict.detail).toContain('三层均正确');
    });
  });

  describe('DIM-001: Add dimension constraint', () => {
    it('adds region dimension with required=true + defaultValue', async () => {
      const testCase = DIMENSION_CONSTRAINT_001;

      const setupResult = await testCase.setup({ app, prisma, provisionTenant });
      const executeResult = await testCase.execute({ ...setupResult, app, prisma });
      const verdict = await testCase.verify({ ...executeResult, ...setupResult, prisma, groundTruth: new OntologyGroundTruth(prisma) });

      await cleanupTenant(setupResult.tenantId);

      expect(verdict.pass).toBe(true);
      expect(verdict.detail).toContain('required=true');
    });
  });
});
