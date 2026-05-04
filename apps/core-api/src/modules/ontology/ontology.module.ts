import { Module } from '@nestjs/common';
import { OntologyController } from './ontology.controller';
import { OntologyService } from './ontology.service';
import { IndexManagerService } from './index-manager.service';

@Module({
  controllers: [OntologyController],
  providers: [OntologyService, IndexManagerService],
  exports: [OntologyService, IndexManagerService],
})
export class OntologyModule {}
