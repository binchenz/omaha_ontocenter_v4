import { Module } from '@nestjs/common';
import { OntologyModule } from '../ontology/ontology.module';
import { QueryModule } from '../query/query.module';
import { CoreSdkService } from './core-sdk.service';
import { TypeResolver } from '../agent/sdk/type-resolver.service';
import { ConnectorClient } from '../agent/connector/connector-client.service';
import { ImportEngine } from '../agent/sdk/import-engine.service';
import { FileParserService } from '../agent/tools/file-parser.service';

@Module({
  imports: [OntologyModule, QueryModule],
  providers: [CoreSdkService, TypeResolver, ConnectorClient, ImportEngine, FileParserService],
  exports: [CoreSdkService, TypeResolver],
})
export class CoreSdkModule {}
