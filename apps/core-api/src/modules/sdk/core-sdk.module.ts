import { Module } from '@nestjs/common';
import { OntologyModule } from '../ontology/ontology.module';
import { QueryModule } from '../query/query.module';
import { CoreSdkService } from './core-sdk.service';
import { TypeResolver } from '../agent/sdk/type-resolver.service';

@Module({
  imports: [OntologyModule, QueryModule],
  providers: [CoreSdkService, TypeResolver],
  exports: [CoreSdkService, TypeResolver],
})
export class CoreSdkModule {}
