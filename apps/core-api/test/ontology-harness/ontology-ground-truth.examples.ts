import { PrismaClient } from '@omaha/db';
import { OntologyGroundTruth } from './ontology-ground-truth';

/**
 * Usage examples for OntologyGroundTruth — Phase 2.1
 *
 * These examples demonstrate the four core methods with mock data patterns.
 * For e2e tests against real data, see ontology-ground-truth.e2e-spec.ts
 */

// =============================================================================
// Example 1: marketMetricValue - Single metric value with filters
// =============================================================================

async function example1_marketMetricValue() {
  const prisma = new PrismaClient();
  const gt = new OntologyGroundTruth(prisma);

  // Use case: "电饭煲 2024年1月 零售额是多少？"
  const value = await gt.marketMetricValue({
    tenantId: 'abc-123-uuid',
    filters: {
      category: '电饭煲',
      month: '2024-01',
      metric: '零售额',
    },
  });

  console.log('Market metric value:', value);
  // Expected output: 123456789.50 (numeric) or null if no data

  await prisma.$disconnect();
}

// Mock Prisma behavior:
// $queryRawUnsafe(
//   "SELECT COALESCE(SUM((properties->>'value')::float8), 0) AS v
//    FROM object_instances
//    WHERE tenant_id = $1::uuid
//      AND object_type = 'market_metric'
//      AND deleted_at IS NULL
//      AND properties->>'category' = $2
//      AND properties->>'month' = $3
//      AND properties->>'metric' = $4",
//   'abc-123-uuid', '电饭煲', '2024-01', '零售额'
// )
// Returns: [{ v: 123456789.5 }] → 123456789.5
//       or [{ v: null }] → null
//       or [] → null

// =============================================================================
// Example 2: brandShareTopN - Top N brands by share with ranking
// =============================================================================

async function example2_brandShareTopN() {
  const prisma = new PrismaClient();
  const gt = new OntologyGroundTruth(prisma);

  // Use case: "电饭煲 2024年Q1 市场份额前5品牌"
  const brandsWithValues = await gt.brandShareTopN({
    tenantId: 'abc-123-uuid',
    category: '电饭煲',
    period: '2024Q1',
    limit: 5,
    withValues: true, // Include share values
  });

  console.log('Top brands with values:', brandsWithValues);
  // Expected: [
  //   { brand: '小米', value: 0.25 },
  //   { brand: '美的', value: 0.20 },
  //   { brand: '九阳', value: 0.15 },
  //   ...
  // ]

  // Use case: Just need brand names for ordering check
  const brandNames = await gt.brandShareTopN({
    tenantId: 'abc-123-uuid',
    category: '电饭煲',
    period: '2024Q1',
    limit: 5,
    withValues: false, // Names only
  });

  console.log('Top brand names:', brandNames);
  // Expected: ['小米', '美的', '九阳', ...]

  // Use case: Query specific price band
  const premiumBrands = await gt.brandShareTopN({
    tenantId: 'abc-123-uuid',
    category: '电饭煲',
    period: '2024Q1',
    limit: 3,
    priceBand: '300以上', // Custom price band
    withValues: true,
  });

  console.log('Premium segment brands:', premiumBrands);

  await prisma.$disconnect();
}

// Mock Prisma behavior:
// $queryRawUnsafe(
//   "SELECT properties->>'brand' AS brand,
//           MAX((properties->>'value')::float8) AS value
//    FROM object_instances
//    WHERE tenant_id = $1::uuid
//      AND object_type = 'brand_share'
//      AND deleted_at IS NULL
//      AND properties->>'category' = $2
//      AND properties->>'period' = $3
//      AND properties->>'priceBand' = $4
//    GROUP BY properties->>'brand'
//    ORDER BY value DESC
//    LIMIT $5",
//   'abc-123-uuid', '电饭煲', '2024Q1', '整体', 5
// )
// Returns: [
//   { brand: '小米', value: 0.25 },
//   { brand: '美的', value: 0.20 },
//   { brand: '九阳', value: 0.15 }
// ]

// =============================================================================
// Example 3: modelMetricTopN - Top N models by metric with ranking
// =============================================================================

async function example3_modelMetricTopN() {
  const prisma = new PrismaClient();
  const gt = new OntologyGroundTruth(prisma);

  // Use case: "电饭煲 2024年1月 零售额份额前10的型号"
  const modelsWithValues = await gt.modelMetricTopN({
    tenantId: 'abc-123-uuid',
    category: '电饭煲',
    period: '2024-01',
    metricField: 'valueShare', // Metric field to rank by
    limit: 10,
    withValues: true,
  });

  console.log('Top models by valueShare:', modelsWithValues);
  // Expected: [
  //   { model: 'MI-RCA-5L', value: 0.05 },
  //   { model: 'MD-X500', value: 0.04 },
  //   ...
  // ]

  // Use case: Top models by average price
  const expensiveModels = await gt.modelMetricTopN({
    tenantId: 'abc-123-uuid',
    category: '电饭煲',
    period: '2024-01',
    metricField: 'avgPrice', // Different metric
    limit: 5,
    withValues: true,
  });

  console.log('Most expensive models:', expensiveModels);
  // Expected: [
  //   { model: 'MI-Premium-X', value: 2999.0 },
  //   { model: 'MD-Luxury-Z', value: 2599.0 },
  //   ...
  // ]

  // Use case: Just model names
  const modelNames = await gt.modelMetricTopN({
    tenantId: 'abc-123-uuid',
    category: '电饭煲',
    period: '2024-01',
    metricField: 'valueShare',
    limit: 10,
    withValues: false,
  });

  console.log('Top model names:', modelNames);
  // Expected: ['MI-RCA-5L', 'MD-X500', ...]

  await prisma.$disconnect();
}

// Mock Prisma behavior:
// $queryRawUnsafe(
//   "SELECT properties->>'model' AS model,
//           MAX((properties->>'valueShare')::float8) AS value
//    FROM object_instances
//    WHERE tenant_id = $1::uuid
//      AND object_type = 'model_metric'
//      AND deleted_at IS NULL
//      AND properties->>'category' = $2
//      AND properties->>'month' = $3
//    GROUP BY properties->>'model'
//    ORDER BY value DESC
//    LIMIT $4",
//   'abc-123-uuid', '电饭煲', '2024-01', 10
// )
// Returns: [
//   { model: 'MI-RCA-5L', value: 0.05 },
//   { model: 'MD-X500', value: 0.04 }
// ]

// =============================================================================
// Example 4: timeSeries - Time-ordered metric values over period range
// =============================================================================

async function example4_timeSeries() {
  const prisma = new PrismaClient();
  const gt = new OntologyGroundTruth(prisma);

  // Use case: "电饭煲 2023年全年 零售额趋势"
  const marketSeries = await gt.timeSeries({
    tenantId: 'abc-123-uuid',
    objectType: 'market_metric',
    metricField: 'value',
    periodField: 'month',
    filters: {
      category: '电饭煲',
      metric: '零售额',
    },
    startPeriod: '2023-01',
    endPeriod: '2023-12',
  });

  console.log('Market metric time series:', marketSeries);
  // Expected: [
  //   { period: '2023-01', value: 100000 },
  //   { period: '2023-02', value: 120000 },
  //   { period: '2023-03', value: 115000 },
  //   ...
  // ]

  // Use case: Brand share trend over quarters
  const brandShareSeries = await gt.timeSeries({
    tenantId: 'abc-123-uuid',
    objectType: 'brand_share',
    metricField: 'value',
    periodField: 'period',
    filters: {
      category: '电饭煲',
      brand: '小米',
      priceBand: '整体',
    },
    startPeriod: '2023Q1',
    endPeriod: '2024Q4',
  });

  console.log('Brand share time series:', brandShareSeries);
  // Expected: [
  //   { period: '2023Q1', value: 0.20 },
  //   { period: '2023Q2', value: 0.22 },
  //   { period: '2023Q3', value: 0.25 },
  //   ...
  // ]

  // Use case: Multiple filters for scoped series
  const regionalSeries = await gt.timeSeries({
    tenantId: 'abc-123-uuid',
    objectType: 'market_metric',
    metricField: 'value',
    periodField: 'month',
    filters: {
      category: '电饭煲',
      metric: '零售额',
      region: '华东',
    },
    startPeriod: '2024-01',
    endPeriod: '2024-06',
  });

  console.log('Regional time series:', regionalSeries);

  await prisma.$disconnect();
}

// Mock Prisma behavior:
// $queryRawUnsafe(
//   "SELECT properties->>'month' AS period,
//           (properties->>'value')::float8 AS value
//    FROM object_instances
//    WHERE tenant_id = $1::uuid
//      AND object_type = $2
//      AND deleted_at IS NULL
//      AND properties->>'month' >= $3
//      AND properties->>'category' = $4
//      AND properties->>'metric' = $5
//      AND properties->>'month' <= '2023-12'
//    ORDER BY properties->>'month'",
//   'abc-123-uuid', 'market_metric', '2023-01', '电饭煲', '零售额'
// )
// Returns: [
//   { period: '2023-01', value: 100000 },
//   { period: '2023-02', value: 120000 },
//   { period: '2023-03', value: 115000 }
// ]

// =============================================================================
// Null-safety examples
// =============================================================================

async function example5_nullSafety() {
  const prisma = new PrismaClient();
  const gt = new OntologyGroundTruth(prisma);

  // Case 1: No data matches filters → null (not throw)
  const noData = await gt.marketMetricValue({
    tenantId: 'abc-123-uuid',
    filters: {
      category: '不存在的品类',
      month: '2099-01',
      metric: '零售额',
    },
  });
  console.log('No data case:', noData); // null

  // Case 2: Empty top-N → empty array (not throw)
  const noBrands = await gt.brandShareTopN({
    tenantId: 'abc-123-uuid',
    category: '不存在的品类',
    period: '2099Q1',
    limit: 5,
  });
  console.log('Empty top-N case:', noBrands); // []

  // Case 3: No time series data → empty array (not throw)
  const noSeries = await gt.timeSeries({
    tenantId: 'abc-123-uuid',
    objectType: 'market_metric',
    metricField: 'value',
    periodField: 'month',
    filters: { category: '不存在的品类' },
    startPeriod: '2099-01',
    endPeriod: '2099-12',
  });
  console.log('Empty series case:', noSeries); // []

  await prisma.$disconnect();
}

// =============================================================================
// Run examples
// =============================================================================

if (require.main === module) {
  console.log('=== OntologyGroundTruth Usage Examples ===\n');
  console.log('Example 1: marketMetricValue');
  console.log('Example 2: brandShareTopN');
  console.log('Example 3: modelMetricTopN');
  console.log('Example 4: timeSeries');
  console.log('Example 5: null-safety\n');
  console.log('Note: These are code examples with mock data patterns.');
  console.log('For actual execution, see ontology-ground-truth.e2e-spec.ts\n');
}

export {
  example1_marketMetricValue,
  example2_brandShareTopN,
  example3_modelMetricTopN,
  example4_timeSeries,
  example5_nullSafety,
};
