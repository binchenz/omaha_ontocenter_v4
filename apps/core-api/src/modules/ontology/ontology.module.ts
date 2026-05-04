import { Module } from '@nestjs/common';
import { OntologyController } from './ontology.controller';
import { OntologyService } from './ontology.service';
import { IndexManagerService } from './index-manager.service';
import { OntologyViewLoader } from './ontology-view-loader.service';

@Module({
  controllers: [OntologyController],
  providers: [OntologyService, IndexManagerService, OntologyViewLoader],
  exports: [OntologyService, IndexManagerService, OntologyViewLoader],
})
export class OntologyModule {}
