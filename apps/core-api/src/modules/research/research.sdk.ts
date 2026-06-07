import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { CurrentUser as CurrentUserType } from '@omaha/shared-types';
import { assertCapability } from '../../common/helpers/assert-capability';
import { UPLOAD_DIR } from '../agent/sdk/import-engine.service';
import { OntologySdk } from '../ontology/ontology.sdk';
import { AvcTemplateExtractor } from './avc-template-extractor';
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
    private readonly avcExtractor: AvcTemplateExtractor,
    private readonly marketMetricImporter: MarketMetricImporter,
    private readonly documentIngestion: DocumentIngestionService,
    private readonly semanticSearch: SemanticSearchService,
  ) {}

  async extractAvcReport(actor: CurrentUserType, params: { fileId: string; category: string }) {
    assertCapability(actor, 'data', 'ingest');
    const filePath = path.join(UPLOAD_DIR, params.fileId);
    const extraction = await this.avcExtractor.extractAll(filePath, params.category);
    const result = await this.marketMetricImporter.importReport(actor.tenantId, extraction);
    // AVC ingest creates market_metric/brand_share/model_metric/avc_report on first run;
    // flush both the TypeResolver and schema-summary caches so the Agent sees them at once.
    this.ontologySdk.invalidate(actor.tenantId);
    return {
      objectType: result.objectType,
      metrics: result.metrics,
      brandShares: result.brandShares,
      modelMetrics: result.modelMetrics,
      coverage: extraction.coverage,
      imported: result.metrics + result.brandShares + result.modelMetrics,
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
