import { Global, Module } from '@nestjs/common';
import { PermissionResolver } from './permission-resolver.service';
import { OntologyModule } from '../ontology/ontology.module';

@Global()
@Module({
  imports: [OntologyModule],
  providers: [PermissionResolver],
  exports: [PermissionResolver],
})
export class PermissionModule {}
