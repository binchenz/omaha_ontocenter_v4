import { Injectable } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { OntologyService } from '../ontology/ontology.service';
import { ImportEngine, ImportResult, InstanceUpsert } from '../agent/sdk/import-engine.service';
import { MarketMetricRow } from './avc-template-extractor';

export const MARKET_METRIC_TYPE = 'market_metric';

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
}
