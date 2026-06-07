import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { PrismaService } from '@omaha/db';
import { PgBossHealthIndicator } from './pg-boss.health';
import { LlmHealthIndicator } from './llm.health';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaService,
    private readonly pgBossHealth: PgBossHealthIndicator,
    private readonly llmHealth: LlmHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  async check() {
    return this.health.check([
      async () => {
        await this.prisma.$queryRawUnsafe('SELECT 1');
        return { prisma: { status: 'up' } };
      },
      () => this.pgBossHealth.isHealthy('pg-boss'),
    ]);
  }

  @Get('llm')
  async llm() {
    const status = this.llmHealth.getLlmStatus();
    return { status: status.reachable ? 'ok' : 'degraded', ...status };
  }
}
