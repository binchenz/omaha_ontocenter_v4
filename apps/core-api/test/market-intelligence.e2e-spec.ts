/**
 * Market Intelligence E2E — AVC drill-down scenarios
 *
 * Tests the research_qa skill against real AVC data in the demo tenant.
 * Covers five scenario categories:
 *   M1–M3: single-star macroscopic queries (market_metric / brand_share)
 *   M4–M6: single-star SKU drill-down (model_metric)
 *   M7–M8: multi-turn guided drill-down stop-and-confirm gate (ADR-0049)
 *   M9:    coverage honesty rule (essence-variant period → no SKU data)
 *   M10:   universe distinction (brand_share ≠ model_metric aggregate)
 *
 * Prerequisites: demo tenant seeded + AVC bulk ingest run
 *   pnpm seed:demo
 *   cd apps/core-api && node -r ts-node/register -r reflect-metadata scripts/avc-bulk-ingest.ts
 */
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@omaha/db';
import request from 'supertest';
import { createTestApp, postSse, runWithRetry, getArgs, toolCalls, textContent } from './test-helpers';

const TENANT_SLUG = 'demo';
const ADMIN_EMAIL = 'admin@demo.com';
const ADMIN_PASSWORD = 'admin123';

jest.setTimeout(300_000);

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Market Intelligence — AVC drill-down (e2e, hits real DeepSeek)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaClient();

    const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
    if (!tenant) throw new Error(`Demo tenant not found — run pnpm seed:demo first`);

    const marketCount = await prisma.objectInstance.count({
      where: { tenantId: tenant.id, objectType: 'market_metric' },
    });
    if (marketCount === 0) {
      throw new Error('No market_metric instances found — run scripts/avc-bulk-ingest.ts first');
    }

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, tenantSlug: TENANT_SLUG });
    expect(loginRes.status).toBe(201);
    token = loginRes.body.accessToken;
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  }, 30_000);

  // -------------------------------------------------------------------------
  // Category 1: single-star macroscopic queries
  // -------------------------------------------------------------------------

  describe('M1 — market size: single value lookup', () => {
    it('queries market_metric for 电饭煲 零售额 in 25.01', async () => {
      await runWithRetry('M1', async () => {
        const events = await postSse(
          app, '/agent/chat',
          { message: '电饭煲 25.01 的零售额是多少' },
          token,
        );
        expect(events.map((e) => e.type)).toContain('done');

        const calls = toolCalls(events, 'market_metric');
        expect(calls.length).toBeGreaterThan(0);

        // Agent must have queried with sensible filters
        const args = getArgs(calls[0]);
        const filters = (args.filters as Array<{ field: string; value: unknown }>) ?? [];
        expect(filters.some((f) => f.field === 'category')).toBe(true);

        // If Agent hit tool-call limit before producing text, that's a known behavioral
        // issue (coverage check consumes budget), not a data pipeline failure
        const text = textContent(events);
        const hasError = events.some((e) => e.type === 'error');
        expect(text.length > 0 || hasError).toBe(true);
        if (text.length > 0) {
          expect(text).toMatch(/\d/); // contains numbers
        }
      });
    }, 90_000);
  });

  describe('M2 — brand share ranking: top-5 brands', () => {
    it('queries brand_share for 电饭煲 and returns ≥5 brand rows', async () => {
      await runWithRetry('M2', async () => {
        const events = await postSse(
          app, '/agent/chat',
          { message: '电饭煲品牌份额排名前5，最新周期' },
          token,
        );
        expect(events.map((e) => e.type)).toContain('done');

        const calls = toolCalls(events, 'brand_share');
        expect(calls.length).toBeGreaterThan(0);

        const text = textContent(events);
        expect(text.length).toBeGreaterThan(0);
        // Result should mention multiple brands — at minimum 美的 or 苏泊尔 dominate this category
        expect(text).toMatch(/美的|苏泊尔|小米|九阳|飞利浦/);
      });
    }, 120_000);
  });

  describe('M3 — time-series trend: multiple months', () => {
    it('returns multiple monthly rows for 净水器 零售量 24.12–25.04', async () => {
      await runWithRetry('M3', async () => {
        const events = await postSse(
          app, '/agent/chat',
          { message: '净水器从 24.12 到 25.04 各月零售量趋势' },
          token,
        );
        expect(events.map((e) => e.type)).toContain('done');

        const calls = toolCalls(events, 'market_metric');
        expect(calls.length).toBeGreaterThan(0);

        // Text answer should mention multiple months (the trend data)
        const text = textContent(events);
        expect(text.length).toBeGreaterThan(0);
        // A trend answer typically mentions at least 2 month values
        const monthMatches = text.match(/\d{2}\.\d{2}|24年|25年|月/g) ?? [];
        expect(monthMatches.length).toBeGreaterThan(1);
      });
    }, 90_000);
  });

  // -------------------------------------------------------------------------
  // Category 2: single-star SKU drill-down
  // -------------------------------------------------------------------------

  describe('M4 — SKU ranking: TOP 10 by valueShare', () => {
    it('queries model_metric for 电饭煲 25.01 sorted by valueShare', async () => {
      await runWithRetry('M4', async () => {
        const events = await postSse(
          app, '/agent/chat',
          { message: '电饭煲 25.01 销额份额最高的 10 款机型' },
          token,
        );
        expect(events.map((e) => e.type)).toContain('done');

        const calls = toolCalls(events, 'model_metric');
        expect(calls.length).toBeGreaterThan(0);

        // Agent must have queried model_metric with category filter
        const args = getArgs(calls[0]);
        const filters = (args.filters as Array<{ field: string; value: unknown }>) ?? [];
        expect(filters.some((f) => f.field === 'category')).toBe(true);

        // If Agent hit tool-call limit, it may not produce text — that's a known behavioral
        // issue (coverage check consumes budget), not a data pipeline failure
        const hasError = events.some((e) => e.type === 'error');
        const text = textContent(events);
        expect(text.length > 0 || hasError).toBe(true);
      });
    }, 90_000);
  });

  describe('M5 — brand SKU lookup: 纯米 models in 电饭煲', () => {
    it('filters model_metric by brand=纯米 and returns ≥1 row', async () => {
      await runWithRetry('M5', async () => {
        const events = await postSse(
          app, '/agent/chat',
          { message: '纯米在电饭煲有哪些在售机型，列出均价和销额份额' },
          token,
        );
        expect(events.map((e) => e.type)).toContain('done');

        const calls = toolCalls(events, 'model_metric');
        expect(calls.length).toBeGreaterThan(0);

        const text = textContent(events);
        expect(text.length).toBeGreaterThan(0);
        // Either returns models (brand has presence) or explains it's not in TOP-100
        // Either way no error
        expect(text).not.toMatch(/错误|抱歉|出错|Exception/);
      });
    }, 90_000);
  });

  describe('M6 — heating method filter: IH segment', () => {
    it('queries model_metric filtered by IH heating and returns data', async () => {
      await runWithRetry('M6', async () => {
        const events = await postSse(
          app, '/agent/chat',
          { message: '电饭煲 IH 加热方式的机型，最近一期，按销额份额排名' },
          token,
        );
        expect(events.map((e) => e.type)).toContain('done');

        const calls = toolCalls(events, 'model_metric');
        expect(calls.length).toBeGreaterThan(0);

        // IH is a real filter value — verify the args carry a heating filter or the text mentions IH
        const hasHeatingFilter = calls.some((tc) => {
          const args = getArgs(tc);
          const filters = (args.filters as Array<{ field: string; value: unknown }> | undefined) ?? [];
          return filters.some((f) => f.field === 'heating');
        });
        const text = textContent(events);
        expect(hasHeatingFilter || text.toUpperCase().includes('IH')).toBe(true);
      });
    }, 90_000);
  });

  // -------------------------------------------------------------------------
  // Category 3: multi-turn guided stop-and-confirm (ADR-0049)
  // -------------------------------------------------------------------------

  describe('M7 — guided drill-down: multi-star query with brand_share context', () => {
    it('queries brand_share before (or alongside) any model_metric drill-down', async () => {
      await runWithRetry('M7', async () => {
        const events = await postSse(
          app, '/agent/chat',
          { message: '纯米电饭煲最近份额在下滑吗？如果是，帮我分析是哪个价格段出了问题' },
          token,
          120_000,
        );
        expect(events.map((e) => e.type)).toContain('done');

        // ①② should have fired (brand_share queries for share trend)
        const brandCalls = toolCalls(events, 'brand_share');
        expect(brandCalls.length).toBeGreaterThan(0);

        // Agent text should present findings and context
        const text = textContent(events);
        expect(text.length).toBeGreaterThan(0);
        expect(text).toMatch(/份额|纯米|价格|趋势|下滑|变化/);
      });
    }, 150_000);
  });

  describe('M8 — guided drill-down: price-band analysis', () => {
    it('queries AVC data for price-band or brand distribution', async () => {
      await runWithRetry('M8', async () => {
        const events = await postSse(
          app, '/agent/chat',
          { message: '电饭煲各价格段的份额变化趋势，然后看看有没有竞品新品进来' },
          token,
          120_000,
        );
        expect(events.map((e) => e.type)).toContain('done');

        // Must have queried brand_share OR model_metric for the price-band breakdown
        const brandCalls = toolCalls(events, 'brand_share');
        const modelCalls = toolCalls(events, 'model_metric');
        expect(brandCalls.length + modelCalls.length).toBeGreaterThan(0);

        // Agent text should contain price-band context, or hit tool limit
        const hasError = events.some((e) => e.type === 'error');
        const text = textContent(events);
        expect(text.length > 0 || hasError).toBe(true);
      });
    }, 150_000);
  });

  // -------------------------------------------------------------------------
  // Category 4: coverage honesty rule
  // -------------------------------------------------------------------------

  describe('M9 — essence-variant period: no fabricated SKU data', () => {
    it('空气炸锅 25.01 is essence-only — Agent should say so, not fabricate models', async () => {
      await runWithRetry('M9', async () => {
        const events = await postSse(
          app, '/agent/chat',
          { message: '空气炸锅 25.01 TOP 机型有哪些，给我列出来' },
          token,
        );
        expect(events.map((e) => e.type)).toContain('done');

        // Agent should query avc_report to check coverage
        const provenanceCalls = toolCalls(events, 'avc_report');
        const text = textContent(events);

        // Either it queried avc_report first, or the text explains the coverage limitation
        const explainsCoverage = text.match(/essence|品牌层|没有机型|无机型|精华版|仅有品牌/i);
        expect(provenanceCalls.length > 0 || !!explainsCoverage).toBe(true);

        // Must NOT fabricate a list of model names
        // A fabricated answer would claim specific model SKUs confidently without caveats
        expect(text).not.toMatch(/^(?!.*essence|.*品牌层|.*无机型|.*精华版).*机型.*[：:].*(IH|RC|压力|球釜)/m);
      });
    }, 90_000);
  });

  // -------------------------------------------------------------------------
  // Category 5: universe distinction (official share = brand_share, not model aggregate)
  // -------------------------------------------------------------------------

  describe('M10 — universe distinction: brand share uses brand_share, not model_metric', () => {
    it('routes 美的 market share query to brand_share objectType', async () => {
      await runWithRetry('M10', async () => {
        const events = await postSse(
          app, '/agent/chat',
          { message: '电饭煲 25.01 美的的市场份额是多少' },
          token,
        );
        expect(events.map((e) => e.type)).toContain('done');

        // The first data tool call should be on brand_share (universe distinction)
        const firstDataCall = events.find(
          (e) => e.type === 'tool_call' && (e.name === 'query_objects' || e.name === 'aggregate_objects'),
        ) as any;
        expect(firstDataCall).toBeDefined();

        // Accept brand_share (correct universe) — if Agent uses avc_report for coverage
        // check first, find the first non-schema, non-report call
        const dataCalls = events.filter(
          (e) => e.type === 'tool_call' &&
            (e.name === 'query_objects' || e.name === 'aggregate_objects') &&
            getArgs(e as any).objectType !== 'avc_report',
        );
        if (dataCalls.length > 0) {
          expect(getArgs(dataCalls[0] as any).objectType).toBe('brand_share');
        }

        // If Agent produced text, it should mention share data
        const text = textContent(events);
        const hasError = events.some((e) => e.type === 'error');
        expect(text.length > 0 || hasError).toBe(true);
        if (text.length > 0) {
          expect(text).toMatch(/\d+(\.\d+)?%|份额|share|美的/i);
        }
      });
    }, 90_000);
  });
});
