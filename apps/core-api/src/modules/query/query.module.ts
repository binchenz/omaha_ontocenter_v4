import { Module } from '@nestjs/common';
import { QueryController } from './query.controller';
import { QueryService } from './query.service';
import { QueryPlannerService } from './query-planner.service';

@Module({
  controllers: [QueryController],
  providers: [QueryService, QueryPlannerService],
  exports: [QueryService],
})
export class QueryModule {}
