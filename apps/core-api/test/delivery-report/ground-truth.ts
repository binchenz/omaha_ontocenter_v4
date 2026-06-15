import { PrismaClient } from '@omaha/db';

/**
 * Ground-truth layer — the independent SQL oracle for the delivery report.
 *
 * Deliberately bypasses the Agent's DSL/query modules and hits object_instances with raw SQL
 * (ADR-0027 anti-false-green: the judge's ruler must not be built by the examinee). Computed at
 * run time from the current DB, so re-ingesting data keeps the truth in sync — no frozen
 * expected-value table to drift (delivery-report design grill, Q4 路 B).
 *
 * Field reality (probed on 纯米 electronics data):
 *   market_metric: category, month, metric(零售额/零售量/零售均价), value
 *   brand_share:   brand, value(=share比例), period, priceBand(0-80…≥300/整体)
 *   model_metric:  brand, model, month, avgPrice, valueShare, volumeShare
 * tenant_id is a uuid column → every query casts $1::uuid explicitly.
 */
export class GroundTruth {
  constructor(private readonly prisma: PrismaClient) {}

  /** Single market-size value (类①). Returns null when no row matches — truth never fabricates. */
  async marketMetricValue(input: {
    tenantId: string;
    category: string;
    month: string;
    metric: string;
  }): Promise<number | null> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ v: number | null }>>(
      `SELECT (properties->>'value')::float8 AS v
         FROM object_instances
        WHERE tenant_id = $1::uuid AND object_type = 'market_metric' AND deleted_at IS NULL
          AND properties->>'category' = $2
          AND properties->>'month' = $3
          AND properties->>'metric' = $4
        LIMIT 1`,
      input.tenantId, input.category, input.month, input.metric,
    );
    const v = rows[0]?.v;
    return v === null || v === undefined ? null : Number(v);
  }

  /**
   * TOP-N brands by share (类②/④). Defaults to the '整体' band (official category share, the
   * universe distinction from the original M10); pass priceBand to scope to a segment. Returns
   * bare names by default, or {brand,value} pairs with withValues for order assertions.
   */
  async brandShareTopN(input: {
    tenantId: string;
    category: string;
    period: string;
    n: number;
    priceBand?: string;
    withValues?: boolean;
  }): Promise<any> {
    const band = input.priceBand ?? '整体';
    const rows = await this.prisma.$queryRawUnsafe<Array<{ brand: string; value: number }>>(
      `SELECT properties->>'brand' AS brand, MAX((properties->>'value')::float8) AS value
         FROM object_instances
        WHERE tenant_id = $1::uuid AND object_type = 'brand_share' AND deleted_at IS NULL
          AND properties->>'category' = $2
          AND properties->>'period' = $3
          AND properties->>'priceBand' = $4
        GROUP BY properties->>'brand'
        ORDER BY value DESC
        LIMIT $5`,
      input.tenantId, input.category, input.period, band, input.n,
    );
    const ranked = rows.map((r) => ({ brand: r.brand, value: Number(r.value) }));
    return input.withValues ? ranked : ranked.map((r) => r.brand);
  }

  /** TOP-N models by valueShare (类⑤). Bare model names, or {model,value} with withValues. */
  async modelMetricTopN(input: {
    tenantId: string;
    category: string;
    month: string;
    n: number;
    withValues?: boolean;
  }): Promise<any> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ model: string; value: number }>>(
      `SELECT properties->>'model' AS model, MAX((properties->>'valueShare')::float8) AS value
         FROM object_instances
        WHERE tenant_id = $1::uuid AND object_type = 'model_metric' AND deleted_at IS NULL
          AND properties->>'category' = $2
          AND properties->>'month' = $3
        GROUP BY properties->>'model'
        ORDER BY value DESC
        LIMIT $4`,
      input.tenantId, input.category, input.month, input.n,
    );
    const ranked = rows.map((r) => ({ model: r.model, value: Number(r.value) }));
    return input.withValues ? ranked : ranked.map((r) => r.model);
  }

  /**
   * Does a brand have ANY data in this category (类③ 纯米诚实锚点)? When false, the correct
   * Agent answer admits "未上榜" rather than fabricating a share — checkHonesty enforces that.
   * Scans both brand_share and model_metric (a brand may exist in one star but not the other).
   */
  async brandPresence(input: { tenantId: string; category: string; brand: string }): Promise<boolean> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*)::int AS n
         FROM object_instances
        WHERE tenant_id = $1::uuid AND deleted_at IS NULL
          AND object_type IN ('brand_share', 'model_metric')
          AND properties->>'category' = $2
          AND properties->>'brand' = $3`,
      input.tenantId, input.category, input.brand,
    );
    return (rows[0]?.n ?? 0) > 0;
  }

  /** Coverage tier for a category+period (类⑥): 'full' | 'essence' | null (no report). */
  async coverage(input: { tenantId: string; category: string; period: string }): Promise<string | null> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ coverage: string }>>(
      `SELECT properties->>'coverage' AS coverage
         FROM object_instances
        WHERE tenant_id = $1::uuid AND object_type = 'avc_report' AND deleted_at IS NULL
          AND properties->>'category' = $2
          AND properties->>'period' = $3
        LIMIT 1`,
      input.tenantId, input.category, input.period,
    );
    return rows[0]?.coverage ?? null;
  }

  async marketMetricTimeSeries(input: {
    tenantId: string;
    category: string;
    metric: string;
  }): Promise<Array<{ month: string; value: number }>> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ month: string; value: number }>>(
      `SELECT properties->>'month' AS month, (properties->>'value')::float8 AS value
         FROM object_instances
        WHERE tenant_id = $1::uuid AND object_type = 'market_metric' AND deleted_at IS NULL
          AND properties->>'category' = $2
          AND properties->>'metric' = $3
        ORDER BY properties->>'month'`,
      input.tenantId, input.category, input.metric,
    );
    return rows.map(r => ({ month: r.month, value: Number(r.value) }));
  }

  async brandShareTimeSeries(input: {
    tenantId: string;
    category: string;
    brand: string;
    priceBand?: string;
  }): Promise<Array<{ period: string; value: number }>> {
    const band = input.priceBand ?? '整体';
    const rows = await this.prisma.$queryRawUnsafe<Array<{ period: string; value: number }>>(
      `SELECT properties->>'period' AS period, (properties->>'value')::float8 AS value
         FROM object_instances
        WHERE tenant_id = $1::uuid AND object_type = 'brand_share' AND deleted_at IS NULL
          AND properties->>'category' = $2
          AND properties->>'brand' = $3
          AND properties->>'priceBand' = $4
        ORDER BY properties->>'period'`,
      input.tenantId, input.category, input.brand, band,
    );
    return rows.map(r => ({ period: r.period, value: Number(r.value) }));
  }

  async brandShareGrowthLeader(input: {
    tenantId: string;
    category: string;
    periodStart: string;
    periodEnd: string;
    priceBand?: string;
  }): Promise<{ brand: string; delta: number } | null> {
    const band = input.priceBand ?? '整体';
    const rows = await this.prisma.$queryRawUnsafe<Array<{ brand: string; delta: number }>>(
      `WITH t1 AS (
        SELECT properties->>'brand' AS brand, (properties->>'value')::float8 AS v
        FROM object_instances
        WHERE tenant_id = $1::uuid AND object_type = 'brand_share' AND deleted_at IS NULL
          AND properties->>'category' = $2
          AND properties->>'period' = $3
          AND properties->>'priceBand' = $5
          AND properties->>'brand' <> '其他'
      ), t2 AS (
        SELECT properties->>'brand' AS brand, (properties->>'value')::float8 AS v
        FROM object_instances
        WHERE tenant_id = $1::uuid AND object_type = 'brand_share' AND deleted_at IS NULL
          AND properties->>'category' = $2
          AND properties->>'period' = $4
          AND properties->>'priceBand' = $5
          AND properties->>'brand' <> '其他'
      )
      SELECT t2.brand, (t2.v - COALESCE(t1.v, 0)) AS delta
      FROM t2 LEFT JOIN t1 ON t1.brand = t2.brand
      ORDER BY delta DESC
      LIMIT 1`,
      input.tenantId, input.category, input.periodStart, input.periodEnd, band,
    );
    if (!rows[0]) return null;
    return { brand: rows[0].brand, delta: Number(rows[0].delta) };
  }

  async crossCategoryGrowth(input: {
    tenantId: string;
    categoryA: string;
    categoryB: string;
    metric: string;
  }): Promise<{ categoryA: number; categoryB: number; fasterCategory: string } | null> {
    const getGrowth = async (cat: string): Promise<number | null> => {
      const series = await this.marketMetricTimeSeries({ tenantId: input.tenantId, category: cat, metric: input.metric });
      if (series.length < 2) return null;
      const first = series[0].value;
      const last = series[series.length - 1].value;
      if (first === 0) return null;
      return (last - first) / Math.abs(first);
    };
    const gA = await getGrowth(input.categoryA);
    const gB = await getGrowth(input.categoryB);
    if (gA === null || gB === null) return null;
    return { categoryA: gA, categoryB: gB, fasterCategory: gA >= gB ? input.categoryA : input.categoryB };
  }
}
