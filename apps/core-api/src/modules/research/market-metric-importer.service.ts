import { Injectable } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { OntologyService } from '../ontology/ontology.service';
import { ImportEngine, ImportResult, InstanceUpsert } from '../agent/sdk/import-engine.service';
import { MarketMetricRow, BrandShareRow } from './avc-template-extractor';

export const MARKET_METRIC_TYPE = 'market_metric';
export const BRAND_SHARE_TYPE = 'brand_share';

/**
 * Imports extracted AVC market-metric rows as Object Instances (ADR-0042 §4). A thin wrapper
 * over the single write path (ImportEngine.importInstances) — it does NOT introduce a second
 * writer. Ensures the `market_metric` Object Type exists (idempotent), then upserts one
 * instance per (category, month, metric) so re-ingesting a report is idempotent.
 */
@Injectable()
export class MarketMetricImporter {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ontologyService: OntologyService,
    private readonly importEngine: ImportEngine,
  ) {}

  async import(tenantId: string, rows: MarketMetricRow[]): Promise<ImportResult> {
    await this.ensureType(tenantId);
    const instances: InstanceUpsert[] = rows.map((r) => ({
      externalId: `${r.category}_${r.month}_${r.metric}`,
      label: `${r.category} ${r.month} ${r.metric}`,
      properties: {
        category: r.category,
        month: r.month,
        metric: r.metric,
        value: r.value,
        sourceReport: r.sourceReport,
      },
    }));
    return this.importEngine.importInstances(tenantId, MARKET_METRIC_TYPE, instances);
  }

  async importBrandShares(tenantId: string, rows: BrandShareRow[]): Promise<ImportResult> {
    await this.ensureBrandShareType(tenantId);
    const instances: InstanceUpsert[] = rows.map((r) => ({
      externalId: `${r.category}_${r.brand}_${r.priceBand}_${r.period}`,
      label: `${r.category} ${r.brand} ${r.priceBand}`,
      properties: {
        category: r.category,
        brand: r.brand,
        priceBand: r.priceBand,
        period: r.period,
        metric: r.metric,
        value: r.value,
        sourceReport: r.sourceReport,
      },
    }));
    return this.importEngine.importInstances(tenantId, BRAND_SHARE_TYPE, instances);
  }

  /** Create the market_metric Object Type if absent (idempotent). */
  private async ensureType(tenantId: string): Promise<void> {
    const existing = await this.prisma.objectType.findFirst({
      where: { tenantId, name: MARKET_METRIC_TYPE },
      select: { id: true },
    });
    if (existing) return;
    await this.ontologyService.createObjectType(tenantId, {
      name: MARKET_METRIC_TYPE,
      label: '市场指标',
      description: 'AVC 月度监测的市场规模指标（零售额/零售量/零售均价等），按品类与月份',
      properties: [
        { name: 'category', label: '品类', type: 'string', filterable: true },
        { name: 'month', label: '月份', type: 'string', filterable: true, sortable: true },
        { name: 'metric', label: '指标', type: 'string', filterable: true },
        { name: 'value', label: '数值', type: 'number', sortable: true },
        { name: 'sourceReport', label: '来源报告', type: 'string' },
      ],
      derivedProperties: [],
    });
  }

  /** Create the brand_share Object Type if absent (idempotent). */
  private async ensureBrandShareType(tenantId: string): Promise<void> {
    const existing = await this.prisma.objectType.findFirst({
      where: { tenantId, name: BRAND_SHARE_TYPE },
      select: { id: true },
    });
    if (existing) return;
    await this.ontologyService.createObjectType(tenantId, {
      name: BRAND_SHARE_TYPE,
      label: '品牌份额',
      description: 'AVC 月度监测的分价格段品牌零售份额，按品类、品牌、价格段',
      properties: [
        { name: 'category', label: '品类', type: 'string', filterable: true },
        { name: 'brand', label: '品牌', type: 'string', filterable: true },
        { name: 'priceBand', label: '价格段', type: 'string', filterable: true },
        { name: 'period', label: '周期', type: 'string', filterable: true },
        { name: 'metric', label: '指标', type: 'string', filterable: true },
        { name: 'value', label: '份额', type: 'number', sortable: true },
        { name: 'sourceReport', label: '来源报告', type: 'string' },
      ],
      derivedProperties: [],
    });
  }
}
