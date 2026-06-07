import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { PgBossService } from '../dataset/pg-boss.provider';

@Injectable()
export class PgBossHealthIndicator extends HealthIndicator {
  constructor(private readonly pgBossService: PgBossService) {
    super();
  }

  async isHealthy(key = 'pg-boss'): Promise<HealthIndicatorResult> {
    const boss = this.pgBossService.getInstance();
    if (!boss) {
      throw new HealthCheckError('pg-boss not started', this.getStatus(key, false));
    }
    try {
      // Proves the DB connection backing pg-boss is alive (not just that the instance was created at startup).
      await boss.getQueueSize('sync-job');
      return this.getStatus(key, true);
    } catch (err) {
      throw new HealthCheckError('pg-boss DB unreachable', this.getStatus(key, false, { error: (err as Error).message }));
    }
  }
}
