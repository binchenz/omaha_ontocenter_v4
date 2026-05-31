import { Module } from '@nestjs/common';
import { OntologyController } from './ontology.controller';
import { OntologyService } from './ontology.service';
import { IndexManagerService } from './index-manager.service';
import { OntologyViewLoader } from './ontology-view-loader.service';
import { ViewManagerService } from './view-manager.service';
import { ArtifactManagerService } from './artifact-manager.service';
import { DraftService } from './draft.service';
import { PublishService } from './publish.service';
import { TemplateService } from './template.service';

@Module({
  controllers: [OntologyController],
  providers: [OntologyService, IndexManagerService, OntologyViewLoader, ViewManagerService, ArtifactManagerService, DraftService, PublishService, TemplateService],
  exports: [OntologyService, IndexManagerService, OntologyViewLoader, ViewManagerService, ArtifactManagerService, DraftService, PublishService, TemplateService],
})
export class OntologyModule {}
