import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@omaha/db';
import { createTestApp, ensureTestTenant, cleanupTestTenant } from './test-helpers';
import type { ObjectEdit, ApplyContext, ApplyResult } from '@omaha/shared-types';
import { ApplyService } from '../src/modules/apply/apply.service';

describe('ApplyService (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let applyService: ApplyService;

  const TEST_OBJECT_TYPE = 'apply_test_widget';

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaClient();
    tenantId = await ensureTestTenant(app);

    // Create a test object type for apply operations
    await prisma.objectType.upsert({
      where: { tenantId_name: { tenantId, name: TEST_OBJECT_TYPE } },
      update: {},
      create: {
        tenantId,
        name: TEST_OBJECT_TYPE,
        label: 'Apply Test Widget',
        properties: [
          { name: 'title', label: 'Title', type: 'string', filterable: true, sortable: true },
          { name: 'count', label: 'Count', type: 'number', filterable: true, sortable: true },
          { name: 'active', label: 'Active', type: 'boolean', filterable: true },
        ],
      },
    });

    applyService = app.get(ApplyService);
  });

  afterAll(async () => {
    await cleanupTestTenant(app);
    await prisma.$disconnect();
    await app.close();
  });

  afterEach(async () => {
    // Clean up instances created during tests
    await prisma.objectInstance.deleteMany({
      where: { tenantId, objectType: TEST_OBJECT_TYPE },
    });
  });

  const ctx: ApplyContext = { tenantId: '', userId: 'test-user-id' };
  beforeEach(() => { ctx.tenantId = tenantId; });

  describe('create', () => {
    it('creates an object instance with properties', async () => {
      const edits: ObjectEdit[] = [
        { op: 'create', objectType: TEST_OBJECT_TYPE, properties: { title: 'Widget A', count: 5, active: true } },
      ];

      const result: ApplyResult = await applyService.apply(edits, ctx);

      expect(result.applied).toBe(1);
      expect(result.created).toHaveLength(1);

      const instance = await prisma.objectInstance.findFirst({
        where: { tenantId, objectType: TEST_OBJECT_TYPE },
      });
      expect(instance).toBeTruthy();
      expect((instance!.properties as any).title).toBe('Widget A');
      expect((instance!.properties as any).count).toBe(5);
    });

    it('creates with externalId and label', async () => {
      const edits: ObjectEdit[] = [
        { op: 'create', objectType: TEST_OBJECT_TYPE, properties: { title: 'Labeled' }, externalId: 'ext-001', label: 'My Widget' },
      ];

      const result = await applyService.apply(edits, ctx);
      expect(result.applied).toBe(1);

      const instance = await prisma.objectInstance.findFirst({
        where: { tenantId, objectType: TEST_OBJECT_TYPE, externalId: 'ext-001' },
      });
      expect(instance!.label).toBe('My Widget');
      expect(instance!.externalId).toBe('ext-001');
    });
  });

  describe('update', () => {
    it('replaces properties fully (full replacement semantics)', async () => {
      // Create an instance first
      const created = await prisma.objectInstance.create({
        data: {
          tenantId,
          objectType: TEST_OBJECT_TYPE,
          externalId: 'upd-001',
          label: 'Original',
          properties: { title: 'Original', count: 10, active: true },
          relationships: {},
        },
      });

      const edits: ObjectEdit[] = [
        { op: 'update', objectId: created.id, properties: { title: 'Updated', count: 20 } },
      ];

      const result = await applyService.apply(edits, ctx);
      expect(result.applied).toBe(1);

      const updated = await prisma.objectInstance.findUnique({ where: { id: created.id } });
      expect((updated!.properties as any).title).toBe('Updated');
      expect((updated!.properties as any).count).toBe(20);
      // 'active' should be gone — full replacement
      expect((updated!.properties as any).active).toBeUndefined();
    });

    it('updates label when provided', async () => {
      const created = await prisma.objectInstance.create({
        data: {
          tenantId,
          objectType: TEST_OBJECT_TYPE,
          externalId: 'upd-002',
          label: 'Old Label',
          properties: { title: 'Test' },
          relationships: {},
        },
      });

      const edits: ObjectEdit[] = [
        { op: 'update', objectId: created.id, properties: { title: 'Test' }, label: 'New Label' },
      ];

      await applyService.apply(edits, ctx);
      const updated = await prisma.objectInstance.findUnique({ where: { id: created.id } });
      expect(updated!.label).toBe('New Label');
    });
  });

  describe('delete', () => {
    it('soft-deletes an instance (sets deletedAt)', async () => {
      const created = await prisma.objectInstance.create({
        data: {
          tenantId,
          objectType: TEST_OBJECT_TYPE,
          externalId: 'del-001',
          properties: { title: 'To Delete' },
          relationships: {},
        },
      });

      const edits: ObjectEdit[] = [{ op: 'delete', objectId: created.id }];
      const result = await applyService.apply(edits, ctx);
      expect(result.applied).toBe(1);

      // Should be soft-deleted (deletedAt set)
      const raw = await prisma.$queryRawUnsafe<any[]>(
        `SELECT deleted_at FROM object_instances WHERE id = $1::uuid`,
        created.id,
      );
      expect(raw[0].deleted_at).not.toBeNull();
    });
  });

  describe('link / unlink', () => {
    let parentId: string;
    let childId: string;

    beforeEach(async () => {
      const parent = await prisma.objectInstance.create({
        data: { tenantId, objectType: TEST_OBJECT_TYPE, externalId: 'link-parent', properties: { title: 'Parent' }, relationships: {} },
      });
      const child = await prisma.objectInstance.create({
        data: { tenantId, objectType: TEST_OBJECT_TYPE, externalId: 'link-child', properties: { title: 'Child' }, relationships: {} },
      });
      parentId = parent.id;
      childId = child.id;
    });

    it('link sets relationship on child instance', async () => {
      const edits: ObjectEdit[] = [
        { op: 'link', from: childId, to: parentId, linkType: 'parentWidget' },
      ];

      const result = await applyService.apply(edits, ctx);
      expect(result.applied).toBe(1);

      const child = await prisma.objectInstance.findUnique({ where: { id: childId } });
      expect((child!.relationships as any).parentWidget).toBe(parentId);
    });

    it('unlink removes relationship from child instance', async () => {
      // First link
      await prisma.objectInstance.update({
        where: { id: childId },
        data: { relationships: { parentWidget: parentId } },
      });

      const edits: ObjectEdit[] = [
        { op: 'unlink', from: childId, to: parentId, linkType: 'parentWidget' },
      ];

      const result = await applyService.apply(edits, ctx);
      expect(result.applied).toBe(1);

      const child = await prisma.objectInstance.findUnique({ where: { id: childId } });
      expect((child!.relationships as any).parentWidget).toBeUndefined();
    });
  });

  describe('validation', () => {
    it('rejects create with unknown objectType', async () => {
      const edits: ObjectEdit[] = [
        { op: 'create', objectType: 'nonexistent_type_xyz', properties: { foo: 'bar' } },
      ];

      const result = await applyService.apply(edits, ctx);
      expect(result.applied).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0].message).toMatch(/object type/i);
    });

    it('rejects update with nonexistent objectId', async () => {
      const edits: ObjectEdit[] = [
        { op: 'update', objectId: '00000000-0000-0000-0000-000000000000', properties: { title: 'X' } },
      ];

      const result = await applyService.apply(edits, ctx);
      expect(result.applied).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0].message).toMatch(/not found/i);
    });
  });

  describe('atomicity', () => {
    it('rolls back all edits if any one fails validation', async () => {
      const edits: ObjectEdit[] = [
        { op: 'create', objectType: TEST_OBJECT_TYPE, properties: { title: 'Should Not Exist' }, externalId: 'atom-001' },
        { op: 'update', objectId: '00000000-0000-0000-0000-000000000000', properties: { title: 'Bad' } },
      ];

      const result = await applyService.apply(edits, ctx);
      expect(result.applied).toBe(0);

      // First edit should NOT have been committed
      const instance = await prisma.objectInstance.findFirst({
        where: { tenantId, externalId: 'atom-001' },
      });
      expect(instance).toBeNull();
    });
  });

  describe('dryRun', () => {
    it('validates but does not commit when dryRun=true', async () => {
      const edits: ObjectEdit[] = [
        { op: 'create', objectType: TEST_OBJECT_TYPE, properties: { title: 'Dry Run' }, externalId: 'dry-001' },
      ];

      const result = await applyService.apply(edits, { ...ctx, dryRun: true });
      expect(result.applied).toBe(1);
      expect(result.created).toHaveLength(1);

      // Should NOT be in the database
      const instance = await prisma.objectInstance.findFirst({
        where: { tenantId, externalId: 'dry-001' },
      });
      expect(instance).toBeNull();
    });
  });
});
