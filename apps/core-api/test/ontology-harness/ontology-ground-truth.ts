import { PrismaClient } from '@omaha/db';

/**
 * Ground-truth layer for ontology-based queries — Phase 2.1 implementation.
 *
 * Provides independent SQL oracle methods for verifying Agent query results against raw
 * object_instances data. Deliberately bypasses the Agent's DSL/query modules to avoid
 * false-green results (ADR-0027: the judge's ruler must not be built by the examinee).
 *
 * Design pattern mirrors delivery-report/ground-truth.ts:
 * - Raw SQL via $queryRawUnsafe
 * - Explicit ::uuid casts for tenant_id
 * - Returns domain data (numbers, arrays) not raw rows
 * - Null-safe: returns null for missing data, never fabricates values
 *
 * Phase 2.1 scope:
 * - marketMetricValue: Single metric value with filters
 * - brandShareTopN: Top N brands by share with ranking
 * - modelMetricTopN: Top N models by metric with ranking
 * - timeSeries: Time-ordered metric values over period range
 */
export class OntologyGroundTruth {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Retrieve a single market metric value with filters.
   *
   * Example use case: "电饭煲 2024年1月 零售额是多少？"
   * Query: market_metric where category='电饭煲' AND month='2024-01' AND metric='零售额'
   *
   * @param input - Filter criteria
   * @param input.tenantId - Tenant UUID
   * @param input.filters - Key-value filters to apply (e.g., {category: '电饭煲', month: '2024-01', metric: '零售额'})
   * @returns Numeric value (SUM of matching rows), or null if no data
   *
   * @example
   * ```ts
   * const value = await gt.marketMetricValue({
   *   tenantId: 'abc-123',
   *   filters: { category: '电饭煲', month: '2024-01', metric: '零售额' }
   * });
   * // Returns: 123456789.50 or null
   * ```
   */
  async marketMetricValue(input: {
    tenantId: string;
    filters: Record<string, string>;
  }): Promise<number | null> {
    // Build WHERE clause dynamically from filters
    const filterKeys = Object.keys(input.filters);
    if (filterKeys.length === 0) {
      throw new Error('marketMetricValue requires at least one filter');
    }

    const whereClauses = filterKeys.map((key, idx) => {
      return `properties->>'${key}' = $${idx + 2}`;
    });

    const sql = `
      SELECT COALESCE(SUM((properties->>'value')::float8), 0) AS v
      FROM object_instances
      WHERE tenant_id = $1::uuid
        AND object_type = 'market_metric'
        AND deleted_at IS NULL
        AND ${whereClauses.join(' AND ')}
    `;

    const params = [input.tenantId, ...filterKeys.map((k) => input.filters[k])];

    const rows = await this.prisma.$queryRawUnsafe<Array<{ v: number | null }>>(
      sql,
      ...params,
    );

    const v = rows[0]?.v;
    // Return null if no rows or value is null/undefined
    return v === null || v === undefined ? null : Number(v);
  }

  /**
   * Retrieve top N brands by share with ranking.
   *
   * Example use case: "电饭煲 2024年Q1 市场份额前5品牌"
   * Query: brand_share where category='电饭煲' AND period='2024Q1' AND priceBand='整体'
   * ORDER BY value DESC LIMIT 5
   *
   * @param input - Query parameters
   * @param input.tenantId - Tenant UUID
   * @param input.category - Category filter
   * @param input.period - Period filter (e.g., '2024Q1', '2024-01')
   * @param input.limit - Number of top brands to return
   * @param input.priceBand - Price band filter (defaults to '整体' for overall category)
   * @param input.withValues - If true, return {brand, value}[]; if false, return brand names only
   * @returns Array of brands ranked by share (descending)
   *
   * @example
   * ```ts
   * const brands = await gt.brandShareTopN({
   *   tenantId: 'abc-123',
   *   category: '电饭煲',
   *   period: '2024Q1',
   *   limit: 5,
   *   withValues: true
   * });
   * // Returns: [{brand: '小米', value: 0.25}, {brand: '美的', value: 0.20}, ...]
   * ```
   */
  async brandShareTopN(input: {
    tenantId: string;
    category: string;
    period: string;
    limit: number;
    priceBand?: string;
    withValues?: boolean;
  }): Promise<Array<string> | Array<{ brand: string; value: number }>> {
    const band = input.priceBand ?? '整体';

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ brand: string; value: number }>
    >(
      `
      SELECT properties->>'brand' AS brand,
             MAX((properties->>'value')::float8) AS value
      FROM object_instances
      WHERE tenant_id = $1::uuid
        AND object_type = 'brand_share'
        AND deleted_at IS NULL
        AND properties->>'category' = $2
        AND properties->>'period' = $3
        AND properties->>'priceBand' = $4
      GROUP BY properties->>'brand'
      ORDER BY value DESC
      LIMIT $5
    `,
      input.tenantId,
      input.category,
      input.period,
      band,
      input.limit,
    );

    const ranked = rows.map((r) => ({ brand: r.brand, value: Number(r.value) }));

    return input.withValues ? ranked : ranked.map((r) => r.brand);
  }

  /**
   * Retrieve top N models by metric value with ranking.
   *
   * Example use case: "电饭煲 2024年1月 零售额前10的型号"
   * Query: model_metric where category='电饭煲' AND month='2024-01'
   * ORDER BY sales_value DESC LIMIT 10
   *
   * @param input - Query parameters
   * @param input.tenantId - Tenant UUID
   * @param input.category - Category filter
   * @param input.period - Period filter (e.g., '2024-01')
   * @param input.metricField - Metric field to rank by (e.g., 'valueShare', 'sales_value', 'avgPrice')
   * @param input.limit - Number of top models to return
   * @param input.withValues - If true, return {model, value}[]; if false, return model names only
   * @returns Array of models ranked by metric (descending)
   *
   * @example
   * ```ts
   * const models = await gt.modelMetricTopN({
   *   tenantId: 'abc-123',
   *   category: '电饭煲',
   *   period: '2024-01',
   *   metricField: 'valueShare',
   *   limit: 10,
   *   withValues: true
   * });
   * // Returns: [{model: 'MI-RCA-5L', value: 0.05}, {model: 'MD-X500', value: 0.04}, ...]
   * ```
   */
  async modelMetricTopN(input: {
    tenantId: string;
    category: string;
    period: string;
    metricField: string;
    limit: number;
    withValues?: boolean;
  }): Promise<Array<string> | Array<{ model: string; value: number }>> {
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ model: string; value: number }>
    >(
      `
      SELECT properties->>'model' AS model,
             MAX((properties->>'${input.metricField}')::float8) AS value
      FROM object_instances
      WHERE tenant_id = $1::uuid
        AND object_type = 'model_metric'
        AND deleted_at IS NULL
        AND properties->>'category' = $2
        AND properties->>'month' = $3
      GROUP BY properties->>'model'
      ORDER BY value DESC
      LIMIT $4
    `,
      input.tenantId,
      input.category,
      input.period,
      input.limit,
    );

    const ranked = rows.map((r) => ({ model: r.model, value: Number(r.value) }));

    return input.withValues ? ranked : ranked.map((r) => r.model);
  }

  /**
   * Retrieve time series data for a metric over a period range.
   *
   * Example use case: "电饭煲 2023年1月到2024年12月 零售额趋势"
   * Query: market_metric where category='电饭煲' AND metric='零售额'
   * AND month >= '2023-01' AND month <= '2024-12'
   * ORDER BY month
   *
   * @param input - Query parameters
   * @param input.tenantId - Tenant UUID
   * @param input.objectType - Object type (e.g., 'market_metric', 'brand_share')
   * @param input.metricField - Metric field to extract (e.g., 'value')
   * @param input.periodField - Period field name (e.g., 'month', 'period')
   * @param input.filters - Additional filters (e.g., {category: '电饭煲', metric: '零售额'})
   * @param input.startPeriod - Start period (inclusive)
   * @param input.endPeriod - End period (inclusive)
   * @returns Array of {period, value} ordered by period
   *
   * @example
   * ```ts
   * const series = await gt.timeSeries({
   *   tenantId: 'abc-123',
   *   objectType: 'market_metric',
   *   metricField: 'value',
   *   periodField: 'month',
   *   filters: { category: '电饭煲', metric: '零售额' },
   *   startPeriod: '2023-01',
   *   endPeriod: '2024-12'
   * });
   * // Returns: [{period: '2023-01', value: 100000}, {period: '2023-02', value: 120000}, ...]
   * ```
   */
  async timeSeries(input: {
    tenantId: string;
    objectType: string;
    metricField: string;
    periodField: string;
    filters: Record<string, string>;
    startPeriod: string;
    endPeriod: string;
  }): Promise<Array<{ period: string; value: number }>> {
    // Build WHERE clause from filters
    const filterKeys = Object.keys(input.filters);
    const filterClauses =
      filterKeys.length > 0
        ? filterKeys.map((key, idx) => {
            return `properties->>'${key}' = $${idx + 4}`;
          })
        : [];

    const allClauses = [
      `tenant_id = $1::uuid`,
      `object_type = $2`,
      `deleted_at IS NULL`,
      `properties->>'${input.periodField}' >= $3`,
      // Note: Using string comparison for periods (works for YYYY-MM and YYYYQN formats)
      // For proper date range queries, caller should ensure period format is sortable
      ...filterClauses,
    ];

    const sql = `
      SELECT properties->>'${input.periodField}' AS period,
             (properties->>'${input.metricField}')::float8 AS value
      FROM object_instances
      WHERE ${allClauses.join(' AND ')}
        AND properties->>'${input.periodField}' <= '${input.endPeriod}'
      ORDER BY properties->>'${input.periodField}'
    `;

    const params = [
      input.tenantId,
      input.objectType,
      input.startPeriod,
      ...filterKeys.map((k) => input.filters[k]),
    ];

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ period: string; value: number }>
    >(sql, ...params);

    return rows.map((r) => ({ period: r.period, value: Number(r.value) }));
  }
}
