import { Module } from '@nestjs/common';
import { ApplyService } from './apply.service';

@Module({
  providers: [ApplyService],
  exports: [ApplyService],
})
export class ApplyModule {}
