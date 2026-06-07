/**
 * Bulk-ingest the research-document PDFs via the single write path (ResearchSdk.ingestDocument).
 *
 * Asset B (ADR-0042): each PDF → per-page text → chunks → e5 embeddings → DocumentChunk rows +
 * a ResearchDocument provenance row + the original stored in the BlobStore. Document-level
 * metadata (品类/机构/季度/标题) is confirmed once here, not per chunk. Runs from apps/core-api so
 * NestJS DI + decorator metadata work; ResearchSdk is a plain singleton, so app.resolve() and
 * app.get() are equivalent. EMBEDDING_PROVIDER=local must be set so the offline e5 model is used.
 *
 *   EMBEDDING_PROVIDER=local node -r ts-node/register -r reflect-metadata scripts/pdf-bulk-ingest.ts
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import * as fs from 'fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ResearchSdk } from '../src/modules/research/research.sdk';
import { PrismaService } from '@omaha/db';
import { UPLOAD_DIR } from '../src/modules/agent/sdk/import-engine.service';
import { normalizeCategory, type CurrentUser } from '@omaha/shared-types';

const ARCHIVE = path.resolve(__dirname, '../../../调研及市场数据');
const TENANT_SLUG = 'demo';

// 品类 + 机构/标题 declared once per document (the file names carry these; no NER).
const DOCS: Array<{ file: string; category: string; agency?: string; title: string }> = [
  { file: '【综合报告-修改版】米家净水器人群调研项目1030.pdf', category: '净水器', title: '米家净水器人群调研项目（综合报告）' },
  { file: '高端厨下净水器用户需求探索报告（终）.pdf', category: '净水器', title: '高端厨下净水器用户需求探索报告' },
  { file: '纯米分体式电饭煲座谈会研究报告-1225-V1.pdf', category: '电饭煲', title: '纯米分体式电饭煲座谈会研究报告' },
  { file: '小米电饭煲用户调研报告.pdf', category: '电饭煲', title: '小米电饭煲用户调研报告' },
  { file: '米家台式净饮机定性研究报告0203.pdf', category: '净饮机', title: '米家台式净饮机定性研究报告' },
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const sdk = await app.resolve(ResearchSdk); // plain singleton; resolve() is safe
  const prisma = app.get(PrismaService);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: TENANT_SLUG } });
  const actor: CurrentUser = {
    id: 'pdf-bulk', email: 'admin@demo.com', name: 'bulk', tenantId: tenant.id,
    roleId: 'admin', roleName: 'admin', permissions: ['*'], permissionRules: [],
  };

  let ok = 0, chunkTotal = 0;
  const failed: Array<{ title: string; error: string }> = [];

  for (const d of DOCS) {
    const canonical = normalizeCategory(d.category);
    if (!canonical) { failed.push({ title: d.title, error: `unknown 品类 ${d.category}` }); continue; }
    // Stage the PDF into UPLOAD_DIR with a safe fileId (ingestDocument reads UPLOAD_DIR/fileId).
    const fileId = `pdf-${ok + failed.length}-${Date.now()}.pdf`;
    fs.copyFileSync(path.join(ARCHIVE, d.file), path.join(UPLOAD_DIR, fileId));
    try {
      const t0 = Date.now();
      const r = await sdk.ingestDocument(actor, { fileId, originalName: d.file, metadata: { category: canonical, agency: d.agency, title: d.title } });
      ok++; chunkTotal += r.chunks;
      console.log(`[ok]   ${canonical.padEnd(4)} "${d.title}" → ${r.chunks} chunks in ${((Date.now()-t0)/1000).toFixed(1)}s (doc ${r.documentId})`);
    } catch (err: any) {
      failed.push({ title: d.title, error: err.message });
      console.log(`[FAIL] ${d.title} → ${err.message}`);
    }
  }

  console.log(`\n[pdf-bulk] done. ok=${ok} failed=${failed.length} chunks=${chunkTotal}`);
  if (failed.length) console.log('[pdf-bulk] failed:', failed.map(f => `${f.title}: ${f.error}`).join(' | '));
  await app.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
