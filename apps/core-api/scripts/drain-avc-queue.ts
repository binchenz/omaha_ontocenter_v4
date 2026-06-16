/**
 * Drain the pg-boss pipeline-run + sync-job queues to completion.
 *
 * The batch re-ingest enqueues 150 pipeline runs but its own AppModule context (which hosts the
 * pg-boss workers) closes after a fixed drain window — if the window is too short, `created` jobs
 * remain in pgboss.job and the reactive chain stalls mid-flight. The jobs are NOT lost (pg-boss
 * persists them); this script just boots a worker context and idles until both queues are empty,
 * polling the queue depth so it exits cleanly once everything is consumed.
 *
 *   node -r ts-node/register -r reflect-metadata scripts/drain-avc-queue.ts [maxSeconds=600]
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '@omaha/db';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pendingDepth(prisma: any): Promise<{ run: number; sync: number }> {
  const rows: Array<{ name: string; n: number }> = await prisma.$queryRawUnsafe(
    `SELECT name, count(*)::int AS n FROM pgboss.job
       WHERE name IN ('pipeline-run','sync-job') AND state IN ('created','active','retry')
       GROUP BY name`,
  );
  const get = (n: string) => Number(rows.find((r) => r.name === n)?.n ?? 0);
  return { run: get('pipeline-run'), sync: get('sync-job') };
}

async function main() {
  const maxSeconds = Number(process.argv[2] ?? 600);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);

  console.log('🔌 workers booted, draining pipeline-run + sync-job queues...');
  const start = Date.now();
  let idleRounds = 0;
  try {
    while ((Date.now() - start) / 1000 < maxSeconds) {
      await sleep(3000);
      const d = await pendingDepth(prisma);
      console.log(`   queue depth: pipeline-run=${d.run} sync-job=${d.sync}`);
      if (d.run === 0 && d.sync === 0) {
        // Require two consecutive empties — a pipeline run completing enqueues a sync job, so a
        // single empty read can race the hand-off between the two queues.
        idleRounds++;
        if (idleRounds >= 2) { console.log('✅ both queues empty'); break; }
      } else {
        idleRounds = 0;
      }
    }
  } finally {
    await app.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
