import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '@omaha/db';
import {
  createTestApp,
  ensureTestTenant,
  loginAsTestTenantAdmin,
  cleanupTestTenant,
} from './test-helpers';

/**
 * #76 — private template library. Save a tuned ontology + Evals question bank as a
 * de-identified template, then apply it: instantiate into a Draft (same path as
 * reverse-inference) + seed the question bank, refine, and publish.
 */
describe('Template library (#76, e2e)', () => {
  let app: INestApplication;
  let token: string;
  let prisma: PrismaService;
  let tenantId: string;
  const createdTemplateIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    tenantId = await ensureTestTenant(app);
    token = await loginAsTestTenantAdmin(app);
  });

  afterAll(async () => {
    for (const id of createdTemplateIds) {
      await prisma.ontologyTemplate.deleteMany({ where: { id } });
    }
    await prisma.ontologyTemplate.deleteMany({ where: { ownerTenantId: tenantId } });
    await prisma.evalQuestion.deleteMany({ where: { tenantId } });
    await prisma.ontologyDraft.deleteMany({ where: { tenantId } });
    await cleanupTestTenant(app);
    await app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeEach(async () => {
    await cleanupTestTenant(app);
    await prisma.ontologyDraft.deleteMany({ where: { tenantId } });
    await prisma.evalQuestion.deleteMany({ where: { tenantId } });
    // A small tuned ontology: a dish type with an allowedValues category, plus one eval.
    await request(app.getHttpServer())
      .post('/ontology/types')
      .set(auth())
      .send({
        name: 'dish',
        label: '菜品',
        description: '餐厅菜品',
        properties: [
          { name: 'dish_code', label: '编号', type: 'string', filterable: true },
          { name: 'category', label: '分类', type: 'string', filterable: true, allowedValues: ['热菜', '凉菜', '主食', '汤'] },
          { name: 'price', label: '价格', type: 'number', unit: '元' },
        ],
      })
      .expect(201);
    await prisma.evalQuestion.create({
      data: {
        tenantId,
        question: '有多少道菜？',
        baselineTool: 'aggregate_objects',
        baselineArgs: { objectType: 'dish', metrics: [{ kind: 'count' }] },
        planSummary: '统计 菜品 数量',
      },
    });
  });

  it('saves the ontology + question bank as a de-identified template', async () => {
    const res = await request(app.getHttpServer())
      .post('/ontology/templates')
      .set(auth())
      .send({ name: '餐厅模板', description: '餐饮通用本体' })
      .expect(201);
    createdTemplateIds.push(res.body.id);

    expect(res.body.name).toBe('餐厅模板');
    expect(res.body.typeCount).toBe(1);
    expect(res.body.questionCount).toBe(1);

    // The stored template carries the allowedValues (knowledge) but no tenant_id / instances.
    const row = await prisma.ontologyTemplate.findUnique({ where: { id: res.body.id } });
    const serialized = JSON.stringify(row!.snapshot);
    expect(serialized).toContain('热菜'); // value set retained
    const dish = (row!.snapshot as any).objectTypes[0];
    expect(dish.description).toBe('餐厅菜品');
    expect(dish.properties.find((p: any) => p.name === 'category').allowedValues).toEqual(['热菜', '凉菜', '主食', '汤']);
  });

  it('lists templates (tenant-independent)', async () => {
    const created = await request(app.getHttpServer()).post('/ontology/templates').set(auth()).send({ name: '模板A' }).expect(201);
    createdTemplateIds.push(created.body.id);
    const list = await request(app.getHttpServer()).get('/ontology/templates').set(auth()).expect(200);
    expect(list.body.map((t: any) => t.id)).toContain(created.body.id);
  });

  it('applies a template into a fresh tenant: instantiates a Draft + seeds the question bank, then publishes', async () => {
    // Save the template from the current (seeded) tenant.
    const saved = await request(app.getHttpServer()).post('/ontology/templates').set(auth()).send({ name: '应用模板' }).expect(201);
    createdTemplateIds.push(saved.body.id);

    // Simulate a NEW client: wipe this tenant's ontology, draft, and evals.
    await cleanupTestTenant(app);
    await prisma.ontologyDraft.deleteMany({ where: { tenantId } });
    await prisma.evalQuestion.deleteMany({ where: { tenantId } });

    // Apply the template.
    const applied = await request(app.getHttpServer())
      .post(`/ontology/templates/${saved.body.id}/apply`)
      .set(auth())
      .expect(200);
    expect(applied.body.types).toBe(1);
    expect(applied.body.questionsAdded).toBe(1);

    // Draft now holds the template's ontology.
    const draft = await request(app.getHttpServer()).get('/ontology/draft').set(auth()).expect(200);
    const dish = draft.body.draft.snapshot.objectTypes.find((t: any) => t.name === 'dish');
    expect(dish).toBeDefined();
    expect(dish.properties.find((p: any) => p.name === 'category').allowedValues).toEqual(['热菜', '凉菜', '主食', '汤']);

    // Question bank seeded.
    const evals = await request(app.getHttpServer()).get('/evals/questions').set(auth()).expect(200);
    expect(evals.body.map((q: any) => q.question)).toContain('有多少道菜？');

    // The applied draft is publishable (all additive → safe).
    await request(app.getHttpServer()).post('/ontology/draft/publish').set(auth()).send({}).expect(200);
    const types = await prisma.objectType.findMany({ where: { tenantId, name: 'dish' } });
    expect(types).toHaveLength(1);
  });
});
