import { PrismaClient } from '@omaha/db';
import { probeAnchors, Anchors } from './anchors';

/**
 * Anchors — runtime probe of the tenant's real data shape, so scenario phrasing never hardcodes
 * a category/month/brand that may not exist (the假性失败 trap from the design grill). Shares the
 * same DB read as ground-truth, so question anchors and truth are derived together → self-consistent
 * and auto-following after re-ingest.
 */
describe('anchors — runtime probe over real data', () => {
  let prisma: PrismaClient;
  let anchors: Anchors | null = null;

  beforeAll(async () => {
    prisma = new PrismaClient();
    anchors = await probeAnchors(prisma);
  }, 30_000);

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  it('discovers at least one category with its latest period', () => {
    if (!anchors) return console.warn('[anchors] no data — skipping');
    expect(anchors.categories.length).toBeGreaterThan(0);
    const cat = anchors.categories[0];
    expect(typeof cat.name).toBe('string');
    expect(typeof cat.latestMarketMonth).toBe('string');
  });

  it('exposes price bands and top brands for a category that has brand_share', () => {
    if (!anchors) return;
    const withBands = anchors.categories.find((c) => c.priceBands.length > 0);
    expect(withBands).toBeDefined();
    // '整体' must be excluded from segment bands (it's the overall, used as default elsewhere)
    expect(withBands!.priceBands).not.toContain('整体');
    expect(withBands!.topBrands.length).toBeGreaterThan(0);
  });

  it('identifies an absent-brand anchor for the honesty scenario (类③)', () => {
    if (!anchors) return;
    // 纯米/chunmi is the intended absent brand; the probe surfaces whichever brand has no data.
    expect(typeof anchors.absentBrand).toBe('string');
    expect(anchors.absentBrand.length).toBeGreaterThan(0);
  });
});
