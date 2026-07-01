/**
 * AVC schema fixture for ontology harness testing (Phase 1)
 *
 * Seeds minimal production-realistic AVC schema (market_metric + brand_metric)
 * matching the definitions from market-metric-importer.service.ts.
 *
 * Zero instances seeded — data is seeded per-scenario in individual tests.
 */

import { PrismaService } from '@omaha/db';

/**
 * References to seeded AVC ObjectTypes
 */
export interface AvcSchemaRefs {
  marketMetricTypeId: string;
  brandMetricTypeId: string;
}

/**
 * Seed minimal AVC schema for testing.
 *
 * Creates:
 * - market_metric ObjectType (零售额/零售量/零售均价, continuous monthly series)
 * - brand_share ObjectType (品牌份额, sparse annual snapshots with priceBand dimension)
 *
 * Schema matches production definitions from MARKET_METRIC_DEF and BRAND_SHARE_DEF.
 *
 * @param prisma PrismaService instance
 * @param tenantId Tenant UUID to seed into
 * @returns Object type IDs for test assertions
 */
export async function seedMinimalAvcSchema(
  prisma: PrismaService,
  tenantId: string,
): Promise<AvcSchemaRefs> {
  // 1. Create market_metric ObjectType
  const marketMetric = await prisma.objectType.create({
    data: {
      tenantId,
      name: 'market_metric',
      label: '市场指标',
      description: 'AVC 月度监测的市场规模指标（零售额/零售量/零售均价等），按品类与月份',
      properties: [
        { name: 'category', label: '品类', type: 'string', filterable: true },
        { name: 'month', label: '月份', type: 'string', filterable: true, sortable: true },
        { name: 'year', label: '年份', type: 'string', filterable: true, sortable: true },
        {
          name: 'metric',
          label: '指标',
          type: 'string',
          filterable: true,
          allowedValues: ['零售额', '零售量', '零售均价'],
        },
        {
          name: 'value',
          label: '数值',
          type: 'number',
          sortable: true,
          // ADR-0061 §1: long-format untagged — 额/量 additive, 均价 ratio.
          // The guard cannot tag per-row, so additivity enforced via skill guidance.
        },
        { name: 'sourceReport', label: '来源报告', type: 'string' },
      ],
      derivedProperties: [],
      dimensions: {
        required: ['category', 'month'],
        defaults: {},
        requiredEquivalents: { month: ['year'] }, // #178: year satisfies month requirement
      },
      semantics: {
        universe: 'whole-market', // ADR-0061 §2: 整体市场口径
        // ADR-0064 §1: continuous monthly series (21.12→present), DENSE
        timeAxis: {
          field: 'month',
          grain: 'month',
          format: 'YY.MM（26.04=2026年4月）',
          density: 'dense',
        },
      },
    },
  });

  // 2. Create brand_share ObjectType
  const brandShare = await prisma.objectType.create({
    data: {
      tenantId,
      name: 'brand_share',
      label: '品牌份额',
      description: 'AVC 月度监测的分价格段品牌零售份额，按品类、品牌、价格段',
      properties: [
        { name: 'category', label: '品类', type: 'string', filterable: true },
        { name: 'brand', label: '品牌', type: 'string', filterable: true },
        {
          name: 'priceBand',
          label: '价格段',
          type: 'string',
          filterable: true,
          // Realistic values: 高端/中端/低端/整体
        },
        { name: 'period', label: '周期', type: 'string', filterable: true },
        {
          name: 'metric',
          label: '指标',
          type: 'string',
          filterable: true,
          allowedValues: ['share'],
        },
        {
          name: 'value',
          label: '份额',
          type: 'number',
          sortable: true,
          // ADR-0061 §1: brand share is non-additive (summing shares = nonsense)
          additivity: 'non-additive',
          // Phase 1 #214: allow SUM when filter pins disjoint brands
          aggregationWhitelist: { disjointEntities: true },
        },
        { name: 'sourceReport', label: '来源报告', type: 'string' },
      ],
      derivedProperties: [],
      // ADR-0061 §3: priceBand defaulted to 整体 AND collapsedDefault (dimension-default-blindspot fix)
      dimensions: {
        required: ['category', 'period'],
        defaults: { priceBand: '整体' },
        collapsedDefault: { priceBand: '整体' },
      },
      semantics: {
        universe: 'whole-market', // ADR-0061 §2: 整体市场份额（官方口径）
        // ADR-0064 §1: SPARSE annual snapshots (~5 points), NOT continuous
        timeAxis: {
          field: 'period',
          grain: 'snapshot',
          format: 'YY.MM',
          density: 'sparse',
        },
      },
    },
  });

  return {
    marketMetricTypeId: marketMetric.id,
    brandMetricTypeId: brandShare.id,
  };
}
