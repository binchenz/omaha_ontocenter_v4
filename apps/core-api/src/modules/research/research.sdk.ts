import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { CurrentUser as CurrentUserType } from '@omaha/shared-types';
import { assertCapability } from '../../common/helpers/assert-capability';
import { UPLOAD_DIR } from '../agent/sdk/import-engine.service';
import { OntologySdk } from '../ontology/ontology.sdk';
import { AvcConnector } from './avc-connector';
import { MarketMetricImporter } from './market-metric-importer.service';
import { DocumentIngestionService, DocumentMetadata } from './document-ingestion.service';
import { SemanticSearchService } from './semantic-search.service';

/**
 * All unstructured-research operations in one focused injectable (ADR-0042 §4, §5).
 * Owns AVC ingestion, document ingestion, and semantic search. AVC ingest creates new
 * Object Types lazily (via MarketMetricImporter), so it invalidates OntologySdk's caches
 * directly afterwards — there is no ontology→research import, so the dependency is a plain
 * constructor injection (no callback seam, which would be easy to leave unwired).
 */
@Injectable()
export class ResearchSdk {
  constructor(
    private readonly ontologySdk: OntologySdk,
    private readonly avcConnector: AvcConnector,
    private readonly marketMetricImporter: MarketMetricImporter,
    private readonly documentIngestion: DocumentIngestionService,
    private readonly semanticSearch: SemanticSearchService,
  ) {}

  /**
   * AVC ingest, post-cutover (#175, ADR-0055 Steps 3–5). The three data stars now flow through the
   * generic Connector + Pipeline path: AvcConnector.fetch() parses the Excel and fans out three raw
   * Datasets (one per star connector); markReady reactively enqueues each star's PipelineRun, which
   * produces a clean Dataset that a SyncJob lands into object_instances. Coverage provenance is the
   * one fact that does NOT flow through Datasets (ADR-0043 §2), so it is written directly here.
   *
   * The returned `imported`/`metrics`/... are RAW row counts now queued for async cleaning — not a
   * synchronous instance count. The reactive chain finishes after this call returns.
   */
  async extractAvcReport(actor: CurrentUserType, params: { fileId: string; category: string }) {
    assertCapability(actor, 'data', 'ingest');
    const filePath = path.join(UPLOAD_DIR, params.fileId);

    // 1. Fan the Excel out into three raw Datasets (reactively triggers the per-star pipelines).
    const fetched = await this.avcConnector.fetch(actor.tenantId, { filePath, category: params.category });

    // 2. Write the coverage provenance row directly (not Dataset data, ADR-0043 §2).
    await this.marketMetricImporter.importReportCoverage(actor.tenantId, {
      sourceReport: fetched.sourceReport,
      category: fetched.category,
      period: fetched.period,
      coverage: fetched.coverage,
    });

    // AVC ingest creates market_metric/brand_share/model_metric/avc_report on first run;
    // flush both the TypeResolver and schema-summary caches so the Agent sees them at once.
    this.ontologySdk.invalidate(actor.tenantId);

    const byStar = Object.fromEntries(fetched.datasets.map((d) => [d.star, d.rowCount]));
    return {
      objectType: 'market_metric',
      metrics: byStar['market_metric'] ?? 0,
      brandShares: byStar['brand_share'] ?? 0,
      modelMetrics: byStar['model_metric'] ?? 0,
      coverage: fetched.coverage,
      imported: fetched.datasets.reduce((sum, d) => sum + d.rowCount, 0),
      datasets: fetched.datasets,
    };
  }

  async ingestDocument(
    actor: CurrentUserType,
    params: { fileId: string; originalName: string; metadata: DocumentMetadata },
  ) {
    assertCapability(actor, 'data', 'ingest');
    const filePath = path.join(UPLOAD_DIR, params.fileId);
    return this.documentIngestion.ingest(actor.tenantId, filePath, params.originalName, params.metadata);
  }

  async searchResearch(
    actor: CurrentUserType,
    params: { query: string; category?: string; priceBand?: string; k?: number },
  ) {
    return this.semanticSearch.search(
      actor.tenantId,
      params.query,
      { category: params.category, priceBand: params.priceBand },
      params.k ?? 6,
    );
  }
}
