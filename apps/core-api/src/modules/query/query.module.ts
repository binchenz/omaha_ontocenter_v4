import { Module } from '@nestjs/common';
import { QueryController } from './query.controller';
import { QueryService } from './query.service';
import { QueryPlannerService } from './query-planner.service';
import { OntologyModule } from '../ontology/ontology.module';

@Module({
  imports: [OntologyModule],
  controllers: [QueryController],
  providers: [QueryService, QueryPlannerService],
  exports: [QueryService],
})
export class QueryModule {}
