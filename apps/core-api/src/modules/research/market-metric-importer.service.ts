import { Injectable } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { OntologyService } from '../ontology/ontology.service';
import { ImportEngine, ImportResult, InstanceUpsert } from '../agent/sdk/import-engine.service';
import { MarketMetricRow, BrandShareRow, ModelMetricRow, AvcVariant } from './avc-template-extractor';
import { DatasetService } from '../dataset/dataset.service';
import { SyncJobService } from '../dataset/sync-job.service';

export const MARKET_METRIC_TYPE = 'market_metric';
export const BRAND_SHARE_TYPE = 'brand_share';
export const MODEL_METRIC_TYPE = 'model_metric';
export const AVC_REPORT_TYPE = 'avc_report';

// ── Row-to-instance mappers (single source of truth per star type) ─────────────

const toMetricInstance = (r: MarketMetricRow): InstanceUpsert => ({
  externalId: `${r.category}_${r.month}_${r.metric}`,
  label: `${r.category} ${r.month} ${r.metric}`,
  properties: { category: r.category, month: r.month, metric: r.metric, value: r.value, sourceReport: r.sourceReport },
});

const toBrandShareInstance = (r: BrandShareRow): InstanceUpsert => ({
  externalId: `${r.category}_${r.brand}_${r.priceBand}_${r.period}`,
  label: `${r.category} ${r.brand} ${r.priceBand}`,
  properties: { category: r.category, brand: r.brand, priceBand: r.priceBand, period: r.period, metric: r.metric, value: r.value, sourceReport: r.sourceReport },
});

const toModelMetricInstance = (r: ModelMetricRow): InstanceUpsert => ({
  externalId: `${r.category}_${r.model}_${r.month}`,
  label: `${r.brand} ${r.model} ${r.month}`,
  properties: { category: r.category, model: r.model, brand: r.brand, heating: r.heating, launchDate: r.launchDate, reservation: r.reservation, month: r.month, valueShare: r.valueShare, volumeShare: r.volumeShare, avgPrice: r.avgPrice, sourceReport: r.sourceReport },
});

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly ontologyService: OntologyService,
    private readonly importEngine: ImportEngine,
    private readonly datasetService: DatasetService,
    private readonly syncJobService: SyncJobService,
  ) {}

  async importReport(
    tenantId: string,
    r: AvcReportExtraction,
  ): Promise<{ metrics: number; brandShares: number; modelMetrics: number; objectType: string }> {
    const [metricResult, shareResult, modelResult] = await Promise.all([
      this.importStar(tenantId, MARKET_METRIC_TYPE, MARKET_METRIC_DEF, 'avc_market_metric',
        r.metrics.map(toMetricInstance)),
      this.importStar(tenantId, BRAND_SHARE_TYPE, BRAND_SHARE_DEF, 'avc_brand_share',
        r.brandShares.map(toBrandShareInstance)),
      this.importStar(tenantId, MODEL_METRIC_TYPE, MODEL_METRIC_DEF, 'avc_model_metric',
        r.modelMetrics.map(toModelMetricInstance)),
      this.importReportCoverage(tenantId, { sourceReport: r.sourceReport, category: r.category, period: r.period, coverage: r.coverage }),
    ]);
    return { metrics: metricResult.imported, brandShares: shareResult.imported, modelMetrics: modelResult.imported, objectType: MARKET_METRIC_TYPE };
  }

  /**
   * Import one star type: write a Dataset first, enqueue SyncJob if an ObjectMapping exists;
   * otherwise fall back to direct ImportEngine call (no mapping configured yet).
   */
  private async importStar(
    tenantId: string,
    starType: string,
    def: Parameters<OntologyService['createObjectType']>[1] & { name: string },
    datasetName: string,
    instances: InstanceUpsert[],
  ): Promise<ImportResult> {
    await this.ensureObjectType(tenantId, def);

    const mapping = await this.prisma.objectMapping.findFirst({
      where: { tenantId, objectType: { name: starType } },
    });

    if (!mapping) {
      // Fallback: no mapping configured yet — write directly (legacy path)
      return this.importEngine.importInstances(tenantId, starType, instances);
    }

    // Dataset path (ADR-0040 §1)
    const rows: Record<string, unknown>[] = instances.map((inst) => ({
      externalId: inst.externalId,
      label: inst.label,
      ...inst.properties,
    }));
    const dataset = await this.datasetService.createDataset(tenantId, {
      name: datasetName,
      connectorId: mapping.connectorId ?? 'avc',
    });
    await this.datasetService.appendRows(tenantId, dataset.id, rows);
    await this.datasetService.markReady(tenantId, dataset.id);
    await this.syncJobService.enqueue(tenantId, dataset.id, mapping.id);
    return { imported: instances.length, skipped: 0, objectType: starType };
  }

  // Keep legacy per-type methods for callers that still use them directly
  async import(tenantId: string, rows: MarketMetricRow[]): Promise<ImportResult> {
    return this.importStar(tenantId, MARKET_METRIC_TYPE, MARKET_METRIC_DEF, 'avc_market_metric',
      rows.map(toMetricInstance));
  }

  async importBrandShares(tenantId: string, rows: BrandShareRow[]): Promise<ImportResult> {
    return this.importStar(tenantId, BRAND_SHARE_TYPE, BRAND_SHARE_DEF, 'avc_brand_share',
      rows.map(toBrandShareInstance));
  }

  async importModels(tenantId: string, rows: ModelMetricRow[]): Promise<ImportResult> {
    return this.importStar(tenantId, MODEL_METRIC_TYPE, MODEL_METRIC_DEF, 'avc_model_metric',
      rows.map(toModelMetricInstance));
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

const MARKET_METRIC_DEF = {
  name: MARKET_METRIC_TYPE,
  label: '市场指标',
  description: 'AVC 月度监测的市场规模指标（零售额/零售量/零售均价等），按品类与月份',
  properties: [
    { name: 'category', label: '品类', type: 'string' as const, filterable: true },
    { name: 'month', label: '月份', type: 'string' as const, filterable: true, sortable: true },
    { name: 'metric', label: '指标', type: 'string' as const, filterable: true },
    { name: 'value', label: '数值', type: 'number' as const, sortable: true },
    { name: 'sourceReport', label: '来源报告', type: 'string' as const },
  ],
  derivedProperties: [],
};

const MODEL_METRIC_DEF = {
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
};

const AVC_REPORT_DEF = {
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

const BRAND_SHARE_DEF = {
  name: BRAND_SHARE_TYPE,
  label: '品牌份额',
  description: 'AVC 月度监测的分价格段品牌零售份额，按品类、品牌、价格段',
  properties: [
    { name: 'category', label: '品类', type: 'string' as const, filterable: true },
    { name: 'brand', label: '品牌', type: 'string' as const, filterable: true },
    { name: 'priceBand', label: '价格段', type: 'string' as const, filterable: true },
    { name: 'period', label: '周期', type: 'string' as const, filterable: true },
    { name: 'metric', label: '指标', type: 'string' as const, filterable: true },
    { name: 'value', label: '份额', type: 'number' as const, sortable: true },
    { name: 'sourceReport', label: '来源报告', type: 'string' as const },
  ],
  derivedProperties: [],
};
