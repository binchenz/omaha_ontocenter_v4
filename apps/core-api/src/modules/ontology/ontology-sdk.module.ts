import { Module } from '@nestjs/common';
import { OntologyModule } from './ontology.module';
import { OntologySdk } from './ontology.sdk';
import { AgentSdkModule } from '../agent/sdk/agent-sdk.module';

@Module({
  imports: [OntologyModule, AgentSdkModule],
  providers: [OntologySdk],
  exports: [OntologySdk],
})
export class OntologySdkModule {}
