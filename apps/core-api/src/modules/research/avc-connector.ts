import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { AvcTemplateExtractor } from './avc-template-extractor';
import { DatasetService } from '../dataset/dataset.service';
import { AvcPipelineProvisioner } from '../pipeline/avc-pipeline-provisioner.service';
import {
  AVC_STARS,
  AvcStarSpec,
  AvcStarRow,
  toMarketMetricRawRow,
  toBrandShareRawRow,
  toModelMetricRawRow,
  MARKET_METRIC_TYPE,
  BRAND_SHARE_TYPE,
  MODEL_METRIC_TYPE,
} from './avc-stars';
import { AvcVariant } from './avc-template-extractor';

export interface AvcFetchParams {
  filePath: string;
  /**
   * Optional caller-asserted 品类. The authoritative category is derived from the file's 目录
   * title (ADR-0058); when supplied here it is used only as a fail-fast cross-check. Omit it to
   * let the file decide (the batch re-ingest path does this).
   */
  category?: string;
}

export interface AvcStarDatasetSummary {
  star: string;
  datasetId: string;
  connectorId: string;
  rowCount: number;
}

export interface AvcFetchResult {
  datasets: AvcStarDatasetSummary[];
  /** Coverage is still surfaced so the importer can write the avc_report provenance row (ADR-0043 §2). */
  coverage: AvcVariant;
  sourceReport: string;
  category: string;
  period: string;
}

/**
 * AvcConnector (#175 cutover, ADR-0055 Steps 3) — the AVC source converged into the generic
 * Connector + Pipeline data plane.
 *
 * `fetch()` parses one AVC Excel via AvcTemplateExtractor, then fans the three semantically
 * distinct stars (market / brand / model) out into THREE raw Datasets — one per star, each under
 * its OWN per-star connector — and marks each ready. markReady() reactively enqueues that star's
 * PipelineRun (ADR-0045), so cleaning (brand normalization, price banding) happens in the Pipeline,
 * not here. It no longer returns the parsed three-star row structure (that was the legacy
 * importStar contract); it returns a summary of the raw Datasets plus the report's coverage.
 *
 * Why three connectors? The reactive orchestrator resolves pipelines by connectorId; a single
 * shared connector would fan the market raw Dataset into the brand/model pipelines too (whose
 * compute steps reference fields the market rows lack). See avc-cutover-routing memory.
 */
@Injectable()
export class AvcConnector {
  private readonly logger = new Logger(AvcConnector.name);

  /** Logical source type. The per-star connectors carry their own concrete types (avc_*_excel). */
  readonly type = 'avc_excel';

  constructor(
    private readonly extractor: AvcTemplateExtractor,
    private readonly prisma: PrismaService,
    private readonly datasetService: DatasetService,
    private readonly provisioner: AvcPipelineProvisioner,
  ) {}

  async fetch(tenantId: string, params: AvcFetchParams): Promise<AvcFetchResult> {
    // Auto-provision pipelines on first run for this tenant (idempotent).
    await this.provisioner.provision(tenantId);

    const extraction = await this.extractor.extractAll(params.filePath, params.category);

    // Map each star's typed rows to flat raw-Dataset rows (single source of truth: avc-stars).
    const rowsByStar: Record<string, AvcStarRow[]> = {
      [MARKET_METRIC_TYPE]: extraction.metrics.map(toMarketMetricRawRow),
      [BRAND_SHARE_TYPE]: extraction.brandShares.map(toBrandShareRawRow),
      [MODEL_METRIC_TYPE]: extraction.modelMetrics.map(toModelMetricRawRow),
    };

    const datasets: AvcStarDatasetSummary[] = [];
    for (const star of AVC_STARS) {
      const rows = rowsByStar[star.objectType] ?? [];
      const connector = await this.ensureConnector(tenantId, star);

      const dataset = await this.datasetService.createDataset(tenantId, {
        name: `${star.datasetPrefix}_${extraction.category}_${extraction.period}`,
        connectorId: connector.id,
        kind: 'raw',
      });
      if (rows.length > 0) {
        await this.datasetService.appendRows(tenantId, dataset.id, rows);
      }
      // Reactive trigger: a raw Dataset going ready enqueues its star's PipelineRun (ADR-0045).
      await this.datasetService.markReady(tenantId, dataset.id);

      datasets.push({ star: star.objectType, datasetId: dataset.id, connectorId: connector.id, rowCount: rows.length });
    }

    this.logger.log(
      `AVC fetch tenant=${tenantId} ${extraction.category} ${extraction.period}: ` +
        datasets.map((d) => `${d.star}=${d.rowCount}`).join(' '),
    );

    return {
      datasets,
      coverage: extraction.coverage,
      sourceReport: extraction.sourceReport,
      category: extraction.category,
      period: extraction.period,
    };
  }

  /** Find-or-create the per-star connector (keyed by its unique type). */
  private async ensureConnector(tenantId: string, star: AvcStarSpec) {
    const existing = await this.prisma.connector.findFirst({
      where: { tenantId, type: star.connectorType },
    });
    if (existing) return existing;
    return this.prisma.connector.create({
      data: { tenantId, name: star.connectorName, type: star.connectorType, status: 'active', config: {} },
    });
  }
}
