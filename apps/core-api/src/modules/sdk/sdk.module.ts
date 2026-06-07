import { Module } from '@nestjs/common';
import { OntologyModule } from '../ontology/ontology.module';
import { ConnectorSdkModule } from '../agent/connector/connector-sdk.module';
import { DbIntrospectionService } from './db-introspection.service';
import { ReverseInferenceService } from './reverse-inference.service';
import { ReverseInferenceController } from './reverse-inference.controller';

/**
 * Reverse-inference: introspect an external DB and propose an ontology draft.
 * What remains of the old CoreSdkModule after the SDK split (ADR-0044) — the
 * monolith's other duties now live in OntologySdk / ConnectorSdk / ResearchSdk.
 */
@Module({
  imports: [OntologyModule, ConnectorSdkModule],
  controllers: [ReverseInferenceController],
  providers: [DbIntrospectionService, ReverseInferenceService],
  exports: [DbIntrospectionService, ReverseInferenceService],
})
export class SdkModule {}
