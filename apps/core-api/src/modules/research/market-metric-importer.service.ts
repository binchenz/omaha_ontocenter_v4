import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { OntologyService } from '../ontology/ontology.service';
import { ImportEngine, ImportResult } from '../agent/sdk/import-engine.service';
import { MarketMetricRow, BrandShareRow, ModelMetricRow, AvcVariant } from './avc-template-extractor';
import { DatasetService } from '../dataset/dataset.service';
import { SyncJobService } from '../dataset/sync-job.service';

export const MARKET_METRIC_TYPE = 'market_metric';
export const BRAND_SHARE_TYPE = 'brand_share';
export const MODEL_METRIC_TYPE = 'model_metric';
export const AVC_REPORT_TYPE = 'avc_report';

/** The per-report provenance fact (ADR-0043 §2): coverage flips per report, so it is stamped here. */
export interface AvcReportProvenance {
  sourceReport: string;
  category: string;
  period: string;
  coverage: AvcVariant;
}

/** The full output of AvcTemplateExtractor.extractAll — one report's four fact layers + provenance. */
export interface AvcReportExtraction {
  category: string;
  period: string;
  coverage: AvcVariant;
  sourceReport: string;
  metrics: MarketMetricRow[];
  brandShares: BrandShareRow[];
  modelMetrics: ModelMetricRow[];
}

/**
 * Imports extracted AVC market-metric rows as Object Instances (ADR-0042 §4, ADR-0040 §1).
 * Each star type is written as a Dataset first, then enqueued for async sync into object_instances
 * via SyncJobService (Dataset path). Falls back to direct ImportEngine call when no ObjectMapping
 * exists yet (backwards compat during migration).
 *
 * THREE-STAR COEXISTENCE (ADR-0042 amendment, ADR-0043): market_metric, brand_share, and
 * model_metric are three independent star objects from different sampling universes.
 * DO NOT derive brand_share by aggregating model_metric rows.
 */
@Injectable()
export class MarketMetricImporter {
  private readonly logger = new Logger(MarketMetricImporter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ontologyService: OntologyService,
    private readonly importEngine: ImportEngine,
    private readonly datasetService: DatasetService,
    private readonly syncJobService: SyncJobService,
  ) {}

  /**
   * Post-cutover (#175, ADR-0055 Steps 3–5): the three data stars (market_metric / brand_share /
   * model_metric) now flow through the generic Connector + Pipeline path — AvcConnector.fetch()
   * emits three raw Datasets, the reactive chain produces the clean rows. The importer's surviving
   * job is ONLY the coverage provenance row (ADR-0043 §2: provenance is metadata, not Dataset data).
   *
   * This method is kept as a thin coverage-only entry point for any historical caller that still
   * passes a full extraction; it logs a deprecation warning and writes coverage alone. New callers
   * should use `importReportCoverage` directly.
   *
   * @deprecated Use AvcConnector.fetch() for the data stars and importReportCoverage() for coverage.
   */
  async importReport(
    tenantId: string,
    r: AvcReportExtraction,
  ): Promise<{ metrics: number; brandShares: number; modelMetrics: number; objectType: string }> {
    this.logger.warn(
      `importReport() is deprecated (ADR-0055): data stars now flow through AvcConnector + Pipeline. ` +
        `Writing coverage provenance only for ${r.sourceReport}.`,
    );
    await this.importReportCoverage(tenantId, {
      sourceReport: r.sourceReport,
      category: r.category,
      period: r.period,
      coverage: r.coverage,
    });
    // The data-star counts are no longer produced here — the Pipeline path owns them.
    return { metrics: 0, brandShares: 0, modelMetrics: 0, objectType: AVC_REPORT_TYPE };
  }

  /**
   * Stamp a report's coverage — always direct, provenance is not Dataset data (ADR-0043 §2).
   */
  async importReportCoverage(tenantId: string, report: AvcReportProvenance): Promise<ImportResult> {
    await this.ensureObjectType(tenantId, AVC_REPORT_DEF);
    return this.importEngine.importInstances(tenantId, AVC_REPORT_TYPE, [
      {
        externalId: report.sourceReport,
        label: `${report.category} ${report.period} (${report.coverage})`,
        properties: { category: report.category, period: report.period, coverage: report.coverage, sourceReport: report.sourceReport },
      },
    ]);
  }

  private async ensureObjectType(
    tenantId: string,
    def: Parameters<OntologyService['createObjectType']>[1] & { name: string },
  ): Promise<void> {
    const existing = await this.prisma.objectType.findFirst({ where: { tenantId, name: def.name }, select: { id: true } });
    if (existing) return;
    await this.ontologyService.createObjectType(tenantId, def);
  }
}

export const MARKET_METRIC_DEF = {
  name: MARKET_METRIC_TYPE,
  label: '市场指标',
  description: 'AVC 月度监测的市场规模指标（零售额/零售量/零售均价等），按品类与月份',
  properties: [
    { name: 'category', label: '品类', type: 'string' as const, filterable: true },
    { name: 'month', label: '月份', type: 'string' as const, filterable: true, sortable: true },
    { name: 'year', label: '年份', type: 'string' as const, filterable: true, sortable: true },
    { name: 'metric', label: '指标', type: 'string' as const, filterable: true, allowedValues: ['零售额', '零售量', '零售均价'] },
    // ADR-0061 §1: long-format measure — additivity belongs to the metric ROW, not the column.
    // 零售额/零售量 are additive; 零售均价 is a ratio. With a single `value` column the guard
    // cannot tag per-row, so the metric-aware additivity is enforced via the skill's groupBy
    // guidance; `value` stays untagged (additive) which is correct for the额/量 rows it usually holds.
    { name: 'value', label: '数值', type: 'number' as const, sortable: true },
    { name: 'sourceReport', label: '来源报告', type: 'string' as const },
  ],
  derivedProperties: [],
  // #178: a `year` filter satisfies the `month` requirement — an annual rollup (groupBy[year]) is a
  // valid coarser period scope (year derived from month in lockstep, ADR-0059), so it need not be
  // rejected DIMENSION_REQUIRED:month and forced into month-exhaustion.
  dimensions: { required: ['category', 'month'], defaults: {}, requiredEquivalents: { month: ['year'] } },
  semantics: {
    universe: 'whole-market' as const, // ADR-0061 §2: 整体市场口径
    // ADR-0064 §1: a continuous monthly series (21.12→present). DENSE — the Agent
    // must draw trends as a monthly line and probe THIS star's real periods, never
    // reverse-infer coverage from brand_share/avc_report's sparse annual snapshots (BUG-2).
    timeAxis: { field: 'month', grain: 'month' as const, format: 'YY.MM（26.04=2026年4月）', density: 'dense' as const },
  },
};

export const MODEL_METRIC_DEF = {
  name: MODEL_METRIC_TYPE,
  label: '机型指标',
  description: 'AVC TOP机型明细（2-7）：单 SKU 月度销额份额/销量份额/零售均价 + 上市日期，按品类、机型、月份',
  properties: [
    { name: 'category', label: '品类', type: 'string' as const, filterable: true },
    { name: 'model', label: '机型', type: 'string' as const, filterable: true },
    { name: 'brand', label: '品牌', type: 'string' as const, filterable: true },
    { name: 'heating', label: '加热方式', type: 'string' as const, filterable: true },
    { name: 'launchDate', label: '上市日期', type: 'string' as const, filterable: true },
    { name: 'reservation', label: '预约功能', type: 'string' as const, filterable: true },
    { name: 'month', label: '月份', type: 'string' as const, filterable: true, sortable: true },
    // ADR-0061 §1: shares are non-additive (summing SKU shares across a group is meaningless);
    // 均价 is a ratio whose weight columns (额/量) are NOT carried on the model row, so a weighted
    // rewrite is impossible — the guard returns RATIO_AVG_UNWEIGHTABLE rather than a wrong mean.
    { name: 'valueShare', label: '销额份额', type: 'number' as const, sortable: true, additivity: 'non-additive' as const },
    { name: 'volumeShare', label: '销量份额', type: 'number' as const, sortable: true, additivity: 'non-additive' as const },
    { name: 'avgPrice', label: '零售均价', type: 'number' as const, sortable: true, additivity: 'ratio' as const },
    { name: 'sourceReport', label: '来源报告', type: 'string' as const },
  ],
  derivedProperties: [],
  // model_metric has no stored `year` field, so no month↔year equivalent applies here.
  dimensions: { required: ['category', 'month'], defaults: {} },
  semantics: {
    universe: 'top-sample' as const, // ADR-0061 §2: TOP-100 样本，非全市场
    // ADR-0064 §1: monthly series too (the TOP-100 panel runs across months). DENSE.
    // `launchDate` stays an ordinary property — an event date, NOT the series axis;
    // naming `month` here is what distinguishes a series axis from an event attribute.
    timeAxis: { field: 'month', grain: 'month' as const, format: 'YY.MM（26.04=2026年4月）', density: 'dense' as const },
  },
};

export const AVC_REPORT_DEF = {
  name: AVC_REPORT_TYPE,
  label: 'AVC报告',
  description: 'AVC 月度报告的来源凭证：记录每份报告的品类、周期与数据覆盖度（full=含机型层 / essence=仅品牌层）',
  properties: [
    { name: 'category', label: '品类', type: 'string' as const, filterable: true },
    { name: 'period', label: '周期', type: 'string' as const, filterable: true, sortable: true },
    { name: 'coverage', label: '覆盖度', type: 'string' as const, filterable: true },
    { name: 'sourceReport', label: '来源报告', type: 'string' as const },
  ],
  derivedProperties: [],
};

export const BRAND_SHARE_DEF = {
  name: BRAND_SHARE_TYPE,
  label: '品牌份额',
  description: 'AVC 月度监测的分价格段品牌零售份额，按品类、品牌、价格段',
  properties: [
    { name: 'category', label: '品类', type: 'string' as const, filterable: true },
    { name: 'brand', label: '品牌', type: 'string' as const, filterable: true },
    { name: 'priceBand', label: '价格段', type: 'string' as const, filterable: true },
    { name: 'period', label: '周期', type: 'string' as const, filterable: true },
    { name: 'metric', label: '指标', type: 'string' as const, filterable: true, allowedValues: ['share'] },
    // ADR-0061 §1: brand share is non-additive — adding shares across price bands / brands is
    // nonsense; the guard rejects SUM(value) with NON_ADDITIVE_SUM and steers to a base-quantity path.
    // Phase 1 #214: aggregationWhitelist.disjointEntities allows SUM when filter pins non-overlapping
    // brands (e.g. brand IN [小米, 米家]) — the planner verifies DB-level disjointness before allowing.
    {
      name: 'value',
      label: '份额',
      type: 'number' as const,
      sortable: true,
      additivity: 'non-additive' as const,
      aggregationWhitelist: { disjointEntities: true },
    },
    { name: 'sourceReport', label: '来源报告', type: 'string' as const },
  ],
  derivedProperties: [],
  // ADR-0061 §3: priceBand is BOTH defaulted (auto-pinned to 整体) AND collapsedDefault
  // (surfaced through the schema so the Agent knows the dimension exists and must be
  // drilled, not reverse-asserted as absent — the dimension-default-blindspot fix).
  dimensions: { required: ['category', 'period'], defaults: { priceBand: '整体' }, collapsedDefault: { priceBand: '整体' } },
  semantics: {
    universe: 'whole-market' as const, // ADR-0061 §2: 整体市场份额（官方口径）
    // ADR-0064 §1: SPARSE annual snapshots (one `period` per report, ~5 points), NOT a
    // continuous series. The Agent must not extrapolate it as a monthly trend, nor let
    // its 5 sparse periods cap market_metric's 53-month coverage (the BUG-2 root cause).
    timeAxis: { field: 'period', grain: 'snapshot' as const, format: 'YY.MM', density: 'sparse' as const },
  },
};
