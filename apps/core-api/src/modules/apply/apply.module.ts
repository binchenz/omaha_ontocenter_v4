import { Module } from '@nestjs/common';
import { OntologyModule } from '../ontology/ontology.module';
import { ApplyService } from './apply.service';

@Module({
  imports: [OntologyModule],
  providers: [ApplyService],
  exports: [ApplyService],
})
export class ApplyModule {}
