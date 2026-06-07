import { Injectable, Logger, OnModuleInit, OnApplicationShutdown } from '@nestjs/common';
import PgBoss from 'pg-boss';

export const PG_BOSS = Symbol('PG_BOSS');

@Injectable()
export class PgBossService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PgBossService.name);
  private boss!: PgBoss;

  async onModuleInit() {
    this.boss = new PgBoss(process.env.DATABASE_URL as string);
    this.boss.on('error', (err) => this.logger.error('pg-boss error', err));
    await this.boss.start();
  }

  async onApplicationShutdown() {
    await this.boss?.stop();
  }

  getInstance(): PgBoss {
    return this.boss;
  }
}

export const pgBossProvider = {
  provide: PG_BOSS,
  useFactory: (svc: PgBossService) => svc.getInstance(),
  inject: [PgBossService],
};
