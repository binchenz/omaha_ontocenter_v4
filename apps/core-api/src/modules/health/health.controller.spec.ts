import { Test, TestingModule } from '@nestjs/testing';
import { HealthCheckService } from '@nestjs/terminus';
import { PrismaService } from '@omaha/db';
import { HealthController } from './health.controller';
import { PgBossHealthIndicator } from './pg-boss.health';
import { LlmHealthIndicator } from './llm.health';

describe('HealthController', () => {
  let controller: HealthController;
  let prisma: { $queryRawUnsafe: jest.Mock };
  let pgBossHealth: PgBossHealthIndicator;
  let llmHealth: LlmHealthIndicator;
  beforeEach(async () => {
    prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };

    const pgBossService = { getInstance: jest.fn().mockReturnValue({ getQueueSize: jest.fn().mockResolvedValue(0) }) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: HealthCheckService, useValue: { check: (indicators: (() => Promise<any>)[]) => Promise.all(indicators.map((fn) => fn())) } },
        { provide: PgBossHealthIndicator, useFactory: () => {
          const indicator = new PgBossHealthIndicator(pgBossService as any);
          return indicator;
        }},
        LlmHealthIndicator,
      ],
    }).compile();

    controller = module.get(HealthController);
    pgBossHealth = module.get(PgBossHealthIndicator);
    llmHealth = module.get(LlmHealthIndicator);
  });

  describe('GET /health', () => {
    it('returns 200 when Prisma and pg-boss are healthy', async () => {
      const result = await controller.check();
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ prisma: { status: 'up' } }),
          expect.objectContaining({ 'pg-boss': { status: 'up' } }),
        ]),
      );
    });

    it('throws when Prisma is down', async () => {
      prisma.$queryRawUnsafe.mockRejectedValue(new Error('connection refused'));
      await expect(controller.check()).rejects.toThrow();
    });

    it('throws when pg-boss is errored', async () => {
      jest.spyOn(pgBossHealth, 'isHealthy').mockRejectedValue(new Error('pg-boss not started'));
      await expect(controller.check()).rejects.toThrow();
    });
  });

  describe('GET /health/llm', () => {
    it('returns reachable:true when last call succeeded', async () => {
      llmHealth.recordSuccess();
      const result = await controller.llm();
      expect(result.reachable).toBe(true);
      expect(result.status).toBe('ok');
      expect(result.lastSuccess).toBeDefined();
    });

    it('returns reachable:false when last call failed', async () => {
      llmHealth.recordFailure('timeout');
      const result = await controller.llm();
      expect(result.reachable).toBe(false);
      expect(result.status).toBe('degraded');
      expect(result.lastError).toBe('timeout');
    });

    it('returns reachable:true when success is more recent than failure', async () => {
      llmHealth.recordFailure('timeout');
      // Ensure success timestamp is after failure
      await new Promise((r) => setTimeout(r, 5));
      llmHealth.recordSuccess();
      const result = await controller.llm();
      expect(result.reachable).toBe(true);
      expect(result.status).toBe('ok');
    });
  });
});
