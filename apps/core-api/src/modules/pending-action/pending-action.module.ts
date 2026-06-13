import { Module } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { PendingActionService } from './pending-action.service';
import { PendingActionController } from './pending-action.controller';

@Module({
  controllers: [PendingActionController],
  providers: [PendingActionService, PrismaService],
  exports: [PendingActionService],
})
export class PendingActionModule {}
