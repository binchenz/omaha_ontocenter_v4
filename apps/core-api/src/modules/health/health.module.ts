import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PgBossHealthIndicator } from './pg-boss.health';
import { LlmHealthIndicator } from './llm.health';
import { DatasetModule } from '../dataset/dataset.module';

@Module({
  imports: [TerminusModule, DatasetModule],
  controllers: [HealthController],
  providers: [PgBossHealthIndicator, LlmHealthIndicator],
  exports: [LlmHealthIndicator],
})
export class HealthModule {}
