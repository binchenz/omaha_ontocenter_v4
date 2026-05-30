/**
 * Cross-relationship aggregation — MECHANISM gate (deterministic, no LLM).
 *
 * Phase-2 gate (ADR-0027): the planner's cross-rel dot-path SQL must equal the
 * direct-SQL ground truth. If this isn't green, the spike dies here — there is
 * no point measuring LLM behavior against a broken mechanism.
 *
 * Calls POST /query/aggregate directly (full real path: DTO → service →
 * planAggregate → planCrossRelAggregate → SQL) with groupBy:["episode_shots.series"].
 *
 * Ground truth (direct SQL, see ADR-0027):
 *   X1 avg duration:  Reborn Villain Heir Turns the Script Around = 4.57s
 *   X2 distinct shotSize: From Mail-Order Bride To Billionaire's Wife = 48
 */
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@omaha/db';
import { createTestApp } from './test-helpers';

const TENANT_SLUG = 'demo-drama';
const ADMIN_EMAIL = 'admin@demo-drama.local';
const ADMIN_PASSWORD = 'demo2026';

describe('Cross-relationship aggregation — mechanism gate (e2e)', () => {
  let app: INestApplication;
  let token: string;
  const prisma = new PrismaClient();

  beforeAll(async () => {
    app = await createTestApp();
    const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
    if (!tenant) throw new Error('demo-drama tenant not found — run setup.ts + seed.ts');
    const supertest = (await import('supertest')).default;
    const res = await supertest(app.getHttpServer())
      .post('/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, tenantSlug: TENANT_SLUG });
    if (res.status !== 201) throw new Error(`login failed: ${res.status}`);
    token = res.body.accessToken;
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function aggregate(body: Record<string, unknown>): Promise<any> {
    const supertest = (await import('supertest')).default;
    return supertest(app.getHttpServer())
      .post('/query/aggregate')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  it('X1: avg shot duration grouped by episode_shots.series matches ground truth', async () => {
    const res = await aggregate({
      objectType: 'shot',
      groupBy: ['episode_shots.series'],
      metrics: [{ kind: 'avg', field: 'duration', alias: 'avg_dur' }],
      orderBy: [{ kind: 'metric', by: 'avg_dur', direction: 'desc' }],
      maxGroups: 5,
    });
    expect(res.status).toBe(201);
    const groups = res.body.groups as Array<{ key: Record<string, unknown>; metrics: Record<string, number> }>;
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBeGreaterThan(0);
    const top = groups[0];
    expect(top.key['episode_shots.series']).toBe('Reborn Villain Heir Turns the Script Around');
    expect(Number(top.metrics.avg_dur)).toBeCloseTo(4.57, 1);
  }, 60_000);

  it('X2: distinct shotSize grouped by episode_shots.series matches ground truth', async () => {
    const res = await aggregate({
      objectType: 'shot',
      groupBy: ['episode_shots.series'],
      metrics: [{ kind: 'countDistinct', field: 'shotSize', alias: 'sizes' }],
      orderBy: [{ kind: 'metric', by: 'sizes', direction: 'desc' }],
      maxGroups: 5,
    });
    expect(res.status).toBe(201);
    const groups = res.body.groups as Array<{ key: Record<string, unknown>; metrics: Record<string, number> }>;
    expect(groups.length).toBeGreaterThan(0);
    const top = groups[0];
    expect(top.key['episode_shots.series']).toBe('From Mail-Order Bride To Billionaire\'s Wife');
    expect(top.metrics.sizes).toBe(48);
  }, 60_000);

  it('rejects an unknown relation name with UNKNOWN_RELATION', async () => {
    const res = await aggregate({
      objectType: 'shot',
      groupBy: ['nonexistent_rel.series'],
      metrics: [{ kind: 'count', alias: 'n' }],
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('UNKNOWN_RELATION');
  }, 60_000);

  it('rejects a non-groupable related field with PROPERTY_NOT_GROUPABLE', async () => {
    const res = await aggregate({
      objectType: 'shot',
      groupBy: ['episode_shots.storyline'], // storyline is not filterable on episode
      metrics: [{ kind: 'count', alias: 'n' }],
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('PROPERTY_NOT_GROUPABLE');
  }, 60_000);

  it('local-only groupBy still works (regression guard)', async () => {
    const res = await aggregate({
      objectType: 'shot',
      groupBy: ['shotSize'],
      metrics: [{ kind: 'count', alias: 'n' }],
      maxGroups: 5,
    });
    expect(res.status).toBe(201);
    expect(Array.isArray(res.body.groups)).toBe(true);
    expect(res.body.groups.length).toBeGreaterThan(0);
  }, 60_000);
});
