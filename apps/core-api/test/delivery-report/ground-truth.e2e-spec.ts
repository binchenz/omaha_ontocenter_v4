import { PrismaClient } from '@omaha/db';
import { GroundTruth } from './ground-truth';

/**
 * Ground-truth layer — smoke + shape tests against the REAL demo DB (电饭煲 single-category
 * data that's currently loaded). Not a circular check: ground-truth IS the definition of truth,
 * so we can only assert it runs (::uuid cast correct, columns exist) and returns sane shapes
 * (positive numbers, non-empty ordered sets). The independence from the Agent's DSL/query path
 * is the whole point (ADR-0027): this hits object_instances with raw SQL only.
 *
 * Skips gracefully if no tenant has market_metric data (e.g. fresh DB before ingest).
 */
describe('ground-truth — raw-SQL truth over real 电饭煲 data', () => {
  let prisma: PrismaClient;
  let gt: GroundTruth;
  let tenantId: string | null = null;
  let category: string;
  let latestMonth: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    gt = new GroundTruth(prisma);
    const row = await prisma.$queryRawUnsafe<Array<{ tenant_id: string }>>(
      `SELECT tenant_id FROM object_instances WHERE object_type='market_metric' AND deleted_at IS NULL GROUP BY tenant_id ORDER BY COUNT(*) DESC LIMIT 1`,
    );
    tenantId = row[0]?.tenant_id ?? null;
    if (!tenantId) return;
    category = (await prisma.$queryRawUnsafe<Array<{ c: string }>>(
      `SELECT properties->>'category' c FROM object_instances WHERE tenant_id=$1::uuid AND object_type='market_metric' AND deleted_at IS NULL GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`,
      tenantId,
    ))[0].c;
    latestMonth = (await prisma.$queryRawUnsafe<Array<{ m: string }>>(
      `SELECT properties->>'month' m FROM object_instances WHERE tenant_id=$1::uuid AND object_type='market_metric' AND deleted_at IS NULL ORDER BY 1 DESC LIMIT 1`,
      tenantId,
    ))[0].m;
  }, 30_000);

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  it('marketMetricValue returns a positive number for 零售额 in the latest month', async () => {
    if (!tenantId) return console.warn('[ground-truth] no market_metric data — skipping');
    const v = await gt.marketMetricValue({ tenantId, category, month: latestMonth, metric: '零售额' });
    expect(typeof v).toBe('number');
    expect(v).toBeGreaterThan(0);
  });

  it('marketMetricValue returns null for a nonexistent month (no fabrication at truth layer)', async () => {
    if (!tenantId) return;
    const v = await gt.marketMetricValue({ tenantId, category, month: '99.99', metric: '零售额' });
    expect(v).toBeNull();
  });

  it('brandShareTopN returns an ordered, deduped brand list for the overall band', async () => {
    if (!tenantId) return;
    const period = (await prisma.$queryRawUnsafe<Array<{ p: string }>>(
      `SELECT properties->>'period' p FROM object_instances WHERE tenant_id=$1::uuid AND object_type='brand_share' AND deleted_at IS NULL ORDER BY 1 DESC LIMIT 1`,
      tenantId,
    ))[0].p;
    const brands = await gt.brandShareTopN({ tenantId, category, period, n: 5 });
    expect(brands.length).toBeGreaterThan(0);
    expect(brands.length).toBeLessThanOrEqual(5);
    // deduped
    expect(new Set(brands).size).toBe(brands.length);
    // ordered desc → asserted via the values variant
    const ranked = await gt.brandShareTopN({ tenantId, category, period, n: 5, withValues: true });
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].value).toBeGreaterThanOrEqual(ranked[i].value);
    }
  });

  // #200 — combined self-brand share: the tenant's OWN share (纯米 ≙ 小米+米家, read from
  // Tenant.settings.selfBrands), the truth a flipped CHM identity-resolution judge checks against.
  it('combinedSelfShare sums the tenant self-brands at the 整体 band', async () => {
    if (!tenantId) return;
    const period = (await prisma.$queryRawUnsafe<Array<{ p: string }>>(
      `SELECT properties->>'period' p FROM object_instances WHERE tenant_id=$1::uuid AND object_type='brand_share' AND deleted_at IS NULL AND properties->>'category'=$2 ORDER BY 1 DESC LIMIT 1`,
      tenantId, category,
    ))[0].p;
    const self = await gt.combinedSelfShare({ tenantId, category, period });
    // Live 纯米 has selfBrands=[小米,米家]; 电饭煲 latest 整体 should be a small positive share.
    expect(self).not.toBeNull();
    expect(self!).toBeGreaterThan(0);
    expect(self!).toBeLessThan(1); // a share fraction, not a percentage
  });

  it('combinedSelfShare returns null when the tenant has no selfBrands configured', async () => {
    if (!tenantId) return;
    // A random uuid tenant has no settings.selfBrands → null (the judge then skips, not fabricates).
    const none = await gt.combinedSelfShare({ tenantId: '00000000-0000-0000-0000-000000000000', category, period: '26.04' });
    expect(none).toBeNull();
  });

  it('brandShareTopN scopes to a specific price band (类④ 价格段攻防)', async () => {
    if (!tenantId) return;
    const row = (await prisma.$queryRawUnsafe<Array<{ b: string; p: string }>>(
      `SELECT properties->>'priceBand' b, properties->>'period' p FROM object_instances WHERE tenant_id=$1::uuid AND object_type='brand_share' AND deleted_at IS NULL AND properties->>'category'=$2 AND properties->>'priceBand' <> '整体' LIMIT 1`,
      tenantId, category,
    ))[0];
    if (!row) return console.warn('[ground-truth] no non-整体 price band for category — skipping');
    const brands = await gt.brandShareTopN({ tenantId, category, period: row.p, n: 3, priceBand: row.b });
    expect(brands.length).toBeGreaterThan(0);
  });

  it('modelMetricTopN returns ≤N models ordered by valueShare (类⑤ 机型洞察)', async () => {
    if (!tenantId) return;
    const monthRow = (await prisma.$queryRawUnsafe<Array<{ m: string }>>(
      `SELECT properties->>'month' m FROM object_instances WHERE tenant_id=$1::uuid AND object_type='model_metric' AND deleted_at IS NULL AND properties->>'category'=$2 ORDER BY 1 DESC LIMIT 1`,
      tenantId, category,
    ))[0];
    if (!monthRow) return console.warn('[ground-truth] no model_metric for category — skipping');
    const models = await gt.modelMetricTopN({ tenantId, category, month: monthRow.m, n: 10, withValues: true });
    expect(models.length).toBeGreaterThan(0);
    expect(models.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < models.length; i++) {
      expect(models[i - 1].value).toBeGreaterThanOrEqual(models[i].value);
    }
  });

  it('brandPresence reports whether a brand has any data (类③ 纯米诚实锚点)', async () => {
    if (!tenantId) return;
    // A brand that almost certainly has data (top brand) vs one that doesn't (纯米 not on board)
    const top = (await prisma.$queryRawUnsafe<Array<{ b: string }>>(
      `SELECT properties->>'brand' b FROM object_instances WHERE tenant_id=$1::uuid AND object_type='brand_share' AND deleted_at IS NULL GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`,
      tenantId,
    ))[0].b;
    expect(await gt.brandPresence({ tenantId, category, brand: top })).toBe(true);
    expect(await gt.brandPresence({ tenantId, category, brand: '__不存在的品牌__' })).toBe(false);
  });

  it('coverage reports full vs essence for a category+period (类⑥ 知识边界)', async () => {
    if (!tenantId) return;
    const row = await prisma.$queryRawUnsafe<Array<{ period: string; coverage: string; cat: string }>>(
      `SELECT properties->>'period' period, properties->>'coverage' coverage, properties->>'category' cat FROM object_instances WHERE tenant_id=$1::uuid AND object_type='avc_report' AND deleted_at IS NULL LIMIT 1`,
      tenantId,
    );
    if (row.length === 0) return console.warn('[ground-truth] no avc_report — skipping coverage');
    const cov = await gt.coverage({ tenantId, category: row[0].cat, period: row[0].period });
    expect(cov).toBe(row[0].coverage);
    // nonexistent period → null
    expect(await gt.coverage({ tenantId, category: row[0].cat, period: '99.99' })).toBeNull();
  });
});
