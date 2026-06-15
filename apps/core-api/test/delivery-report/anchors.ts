import { PrismaClient } from '@omaha/db';

/**
 * Anchors — the tenant's real data shape, probed once at run time and shared by scenario
 * templates and ground-truth alike. Hardcoding "电饭煲 25.01" was the design grill's假性失败
 * trap: questions must aim at data that exists. Everything here is discovered, never assumed,
 * so re-ingest (10 品类 / 5 周期) is picked up automatically.
 */
export interface CategoryAnchor {
  name: string;
  /** Latest month present on market_metric (类①/⑤ use month). '' if none. */
  latestMarketMonth: string;
  /** Latest period present on brand_share (类②/④ use period). '' if none. */
  latestBrandPeriod: string;
  /** All brand_share periods in chronological order (类⑦ trend scenarios). */
  allBrandPeriods: string[];
  /** Latest month present on model_metric. '' if none. */
  latestModelMonth: string;
  /** Segment price bands, '整体' excluded (类④). */
  priceBands: string[];
  /** Top brands by row count in this category (for A-vs-B phrasing). */
  topBrands: string[];
}

export interface Anchors {
  tenantId: string;
  categories: CategoryAnchor[];
  /** A brand with no data in the leading category — the honesty anchor (类③, intended 纯米). */
  absentBrand: string;
}

const ABSENT_CANDIDATES = ['纯米', 'chunmi', '__no_such_brand__'];

/** Returns null when no tenant has any market_metric/brand_share data yet (fresh DB). */
export async function probeAnchors(prisma: PrismaClient): Promise<Anchors | null> {
  const q = <T>(sql: string, ...a: unknown[]) => prisma.$queryRawUnsafe<T[]>(sql, ...a);

  const tenantRow = await q<{ tenant_id: string }>(
    `SELECT tenant_id FROM object_instances
      WHERE object_type IN ('market_metric','brand_share','model_metric') AND deleted_at IS NULL
      GROUP BY tenant_id ORDER BY COUNT(*) DESC LIMIT 1`,
  );
  const tenantId = tenantRow[0]?.tenant_id;
  if (!tenantId) return null;

  const catRows = await q<{ c: string }>(
    `SELECT properties->>'category' c FROM object_instances
      WHERE tenant_id=$1::uuid AND object_type IN ('market_metric','brand_share','model_metric')
        AND deleted_at IS NULL AND properties->>'category' IS NOT NULL
      GROUP BY 1 ORDER BY COUNT(*) DESC`,
    tenantId,
  );

  const categories: CategoryAnchor[] = [];
  for (const { c } of catRows) {
    const latest = async (objectType: string, field: string) =>
      (await q<{ x: string }>(
        `SELECT properties->>'${field}' x FROM object_instances
          WHERE tenant_id=$1::uuid AND object_type=$2 AND deleted_at IS NULL
            AND properties->>'category'=$3 AND properties->>'${field}' IS NOT NULL
          ORDER BY 1 DESC LIMIT 1`,
        tenantId, objectType, c,
      ))[0]?.x ?? '';

    const bands = (await q<{ b: string }>(
      `SELECT properties->>'priceBand' b FROM object_instances
        WHERE tenant_id=$1::uuid AND object_type='brand_share' AND deleted_at IS NULL
          AND properties->>'category'=$2 AND properties->>'priceBand' <> '整体'
          AND properties->>'priceBand' IS NOT NULL
        GROUP BY 1 ORDER BY COUNT(*) DESC`,
      tenantId, c,
    )).map((r) => r.b);

    const allPeriods = (await q<{ p: string }>(
      `SELECT DISTINCT properties->>'period' AS p FROM object_instances
        WHERE tenant_id=$1::uuid AND object_type='brand_share' AND deleted_at IS NULL
          AND properties->>'category'=$2 AND properties->>'period' IS NOT NULL
        ORDER BY 1`,
      tenantId, c,
    )).map((r) => r.p);

    const brands = (await q<{ b: string }>(
      `SELECT properties->>'brand' b FROM object_instances
        WHERE tenant_id=$1::uuid AND object_type IN ('brand_share','model_metric') AND deleted_at IS NULL
          AND properties->>'category'=$2 AND properties->>'brand' IS NOT NULL
          AND properties->>'brand' <> '其他'
        GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 8`,
      tenantId, c,
    )).map((r) => r.b);

    categories.push({
      name: c,
      latestMarketMonth: await latest('market_metric', 'month'),
      latestBrandPeriod: await latest('brand_share', 'period'),
      allBrandPeriods: allPeriods,
      latestModelMonth: await latest('model_metric', 'month'),
      priceBands: bands,
      topBrands: brands,
    });
  }

  // 纯米's primary product is 电饭煲 — promote it to lead position for scenario anchoring.
  // Other categories remain available for cross-category trend scenarios (TRD-5).
  const primaryIdx = categories.findIndex(c => c.name === '电饭煲');
  if (primaryIdx > 0) {
    const [primary] = categories.splice(primaryIdx, 1);
    categories.unshift(primary);
  }

  // Pick the first candidate absent from the leading category, else a synthetic sentinel.
  const lead = categories[0];
  let absentBrand = '__no_such_brand__';
  for (const cand of ABSENT_CANDIDATES) {
    const present = lead?.topBrands.includes(cand);
    if (!present) { absentBrand = cand; break; }
  }

  return { tenantId, categories, absentBrand };
}
