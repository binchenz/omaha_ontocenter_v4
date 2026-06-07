import 'reflect-metadata';
import * as dotenv from 'dotenv'; import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ResearchSdk } from '../src/modules/research/research.sdk';
import { PrismaService } from '@omaha/db';
(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const sdk = await app.resolve(ResearchSdk);
  const prisma = app.get(PrismaService);
  const t = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'demo' } });
  const actor: any = { tenantId: t.id, permissions: ['*'] };
  try {
    const rows = await sdk.searchResearch(actor, { query: '净水器用户最关心什么', category: '净水器', k: 5 });
    console.log('OK results=', rows.length);
    rows.slice(0,3).forEach((r:any)=>console.log('  dist=', Number(r.distance).toFixed(4), 'p.'+r.provenance.page, (r.text||'').slice(0,40)));
  } catch (e:any) { console.error('SEARCH_ERROR:', e.message, '\n', e.stack?.split('\n').slice(0,4).join('\n')); }
  await app.close();
})().catch(e=>{console.error('FATAL', e.message);process.exit(1)});
