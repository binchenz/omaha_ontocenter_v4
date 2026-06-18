import { Module } from '@nestjs/common';
import { ResearchSdk } from './research.sdk';
import { AvcTemplateExtractor } from './avc-template-extractor';
import { AvcConnector } from './avc-connector';
import { MarketMetricImporter } from './market-metric-importer.service';
import { DocumentTextExtractor } from './document-text-extractor';
import { Chunker } from './chunker';
import { DocumentIngestionService } from './document-ingestion.service';
import { SemanticSearchService } from './semantic-search.service';
import { EMBEDDING_CLIENT } from './embedding/embedding-client.interface';
import { ArkEmbeddingClient } from './embedding/ark-embedding-client';
import { LocalE5EmbeddingClient } from './embedding/local-e5-embedding-client';
import { BLOB_STORE, BLOB_DIR, LocalBlobStore } from './blob-store';
import { OntologyModule } from '../ontology/ontology.module';
import { OntologySdkModule } from '../ontology/ontology-sdk.module';
import { AgentSdkModule } from '../agent/sdk/agent-sdk.module';
import { DatasetModule } from '../dataset/dataset.module';
import { PipelineModule } from '../pipeline/pipeline.module';

@Module({
  imports: [OntologyModule, OntologySdkModule, AgentSdkModule, DatasetModule, PipelineModule],
  providers: [
    ResearchSdk,
    AvcTemplateExtractor,
    AvcConnector,
    MarketMetricImporter,
    DocumentTextExtractor,
    Chunker,
    DocumentIngestionService,
    SemanticSearchService,
    {
      provide: EMBEDDING_CLIENT,
      useClass: process.env.EMBEDDING_PROVIDER === 'local' ? LocalE5EmbeddingClient : ArkEmbeddingClient,
    },
    { provide: BLOB_STORE, useFactory: () => new LocalBlobStore(BLOB_DIR) },
  ],
  exports: [ResearchSdk, EMBEDDING_CLIENT],
})
export class ResearchModule {}
