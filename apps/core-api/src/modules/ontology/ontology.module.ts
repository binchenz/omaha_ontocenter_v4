import { Module } from '@nestjs/common';
import { OntologyController } from './ontology.controller';
import { OntologyService } from './ontology.service';
import { IndexManagerService } from './index-manager.service';
import { OntologyViewLoader } from './ontology-view-loader.service';
import { ViewManagerService } from './view-manager.service';

@Module({
  controllers: [OntologyController],
  providers: [OntologyService, IndexManagerService, OntologyViewLoader, ViewManagerService],
  exports: [OntologyService, IndexManagerService, OntologyViewLoader, ViewManagerService],
})
export class OntologyModule {}
