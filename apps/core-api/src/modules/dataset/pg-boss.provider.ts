import { Injectable, Inject, Logger, OnApplicationShutdown } from '@nestjs/common';
import PgBoss from 'pg-boss';

export const PG_BOSS = Symbol('PG_BOSS');

/**
 * Subscribe a worker to a pg-boss queue, owning the one lifecycle invariant every consumer must
 * honor: createQueue() MUST complete before work(), or pg-boss v10 silently drops sent jobs. Both
 * the Pipeline Run Worker and the Sync Job Worker route their onModuleInit through here, so the rule
 * (and the per-job batch fan-out) lives in exactly one place. createQueue is an idempotent upsert,
 * safe to call on every boot.
 */
export async function consumeQueue<T extends object>(
  boss: Pick<PgBoss, 'createQueue' | 'work'>,
  queue: string,
  handler: (job: PgBoss.Job<T>) => Promise<void>,
): Promise<void> {
  await boss.createQueue(queue);
  await boss.work<T>(queue, async (jobs) => {
    for (const job of jobs) {
      await handler(job);
    }
  });
}

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
