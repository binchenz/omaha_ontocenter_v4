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
    { name: 'value', label: '数值', type: 'number' as const, sortable: true },
    { name: 'sourceReport', label: '来源报告', type: 'string' as const },
  ],
  derivedProperties: [],
  dimensions: { required: ['category', 'month'], defaults: {} },
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
    { name: 'valueShare', label: '销额份额', type: 'number' as const, sortable: true },
    { name: 'volumeShare', label: '销量份额', type: 'number' as const, sortable: true },
    { name: 'avgPrice', label: '零售均价', type: 'number' as const, sortable: true },
    { name: 'sourceReport', label: '来源报告', type: 'string' as const },
  ],
  derivedProperties: [],
  dimensions: { required: ['category', 'month'], defaults: {} },
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
    { name: 'value', label: '份额', type: 'number' as const, sortable: true },
    { name: 'sourceReport', label: '来源报告', type: 'string' as const },
  ],
  derivedProperties: [],
  dimensions: { required: ['category', 'period'], defaults: { priceBand: '整体' } },
};
