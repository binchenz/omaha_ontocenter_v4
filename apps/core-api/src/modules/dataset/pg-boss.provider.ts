import { Injectable, Inject, Logger, OnApplicationShutdown } from '@nestjs/common';
import PgBoss from 'pg-boss';

export const PG_BOSS = Symbol('PG_BOSS');

/**
 * Async factory: create AND start pg-boss before the token resolves, so every
 * consumer (SyncJobWorker, PipelineRunWorker, …) receives a started instance in
 * its own onModuleInit. Starting inside a separate service's onModuleInit raced
 * the factory and left the token undefined.
 */
export const pgBossProvider = {
  provide: PG_BOSS,
  useFactory: async (): Promise<PgBoss> => {
    const logger = new Logger('PgBoss');
    const boss = new PgBoss(process.env.DATABASE_URL as string);
    boss.on('error', (err) => logger.error('pg-boss error', err));
    await boss.start();
    return boss;
  },
};

/** Thin accessor + shutdown owner for the started pg-boss instance. */
@Injectable()
export class PgBossService implements OnApplicationShutdown {
  constructor(@Inject(PG_BOSS) private readonly boss: PgBoss) {}

  async onApplicationShutdown() {
    await this.boss?.stop();
  }

  getInstance(): PgBoss {
    return this.boss;
  }
}
