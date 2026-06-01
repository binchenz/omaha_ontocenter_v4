import { Module } from '@nestjs/common';
import { OntologyModule } from '../ontology/ontology.module';
import { QueryModule } from '../query/query.module';
import { CoreSdkService } from './core-sdk.service';
import { TypeResolver } from '../agent/sdk/type-resolver.service';
import { ConnectorClient } from '../agent/connector/connector-client.service';
import { ImportEngine } from '../agent/sdk/import-engine.service';
import { FileParserService } from '../agent/tools/file-parser.service';
import { DbIntrospectionService } from './db-introspection.service';
import { ReverseInferenceService } from './reverse-inference.service';
import { ReverseInferenceController } from './reverse-inference.controller';
import { AvcTemplateExtractor } from '../research/avc-template-extractor';
import { MarketMetricImporter } from '../research/market-metric-importer.service';
import { DocumentTextExtractor } from '../research/document-text-extractor';
import { Chunker } from '../research/chunker';
import { DocumentIngestionService } from '../research/document-ingestion.service';
import { SemanticSearchService } from '../research/semantic-search.service';
import { EMBEDDING_CLIENT } from '../research/embedding/embedding-client.interface';
import { ArkEmbeddingClient } from '../research/embedding/ark-embedding-client';
import { BLOB_STORE, BLOB_DIR, LocalBlobStore } from '../research/blob-store';

@Module({
  imports: [OntologyModule, QueryModule],
  controllers: [ReverseInferenceController],
  providers: [
    CoreSdkService, TypeResolver, ConnectorClient, ImportEngine, FileParserService,
    DbIntrospectionService, ReverseInferenceService, AvcTemplateExtractor, MarketMetricImporter,
    DocumentTextExtractor, Chunker, DocumentIngestionService, SemanticSearchService,
    { provide: EMBEDDING_CLIENT, useClass: ArkEmbeddingClient },
    { provide: BLOB_STORE, useFactory: () => new LocalBlobStore(BLOB_DIR) },
  ],
  exports: [CoreSdkService, TypeResolver, DbIntrospectionService, ReverseInferenceService],
})
export class CoreSdkModule {}
