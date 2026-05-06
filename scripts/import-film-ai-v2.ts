import * as path from 'path';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@omaha/db';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { bootstrapTenant } from './lib/tenant-bootstrap';
import { bootstrapOntology } from './lib/ontology-bootstrap';
import { importInstances, type InstanceInput } from './lib/object-instance-importer';
import { flattenBookAnalysis } from './lib/book-analysis-flattener';
import { FilmAiV2SourceReader, type BookWithAnalysis, type MainCharExpanded, type EdgeExpanded, type PlotBeatExpanded, type EmotionalPointExpanded, type MarketScoreExpanded } from './lib/film-ai-v2-source-reader';
import { resolveCharacterName, type CandidateCharacter } from './lib/entity-resolver';
import {
  FILM_AI_TENANT_SLUG,
  FILM_AI_TENANT_NAME,
  FILM_AI_ADMIN_EMAIL,
  filmAiV2OntologySpec,
  V1_OBJECT_TYPES_TO_CLEANUP,
} from './lib/film-ai-v2-ontology-spec';

interface CliFlags {
  dryRun: boolean;
  confirm: boolean;
}

function parseArgs(argv: string[]): CliFlags {
  return {
    dryRun: argv.includes('--dry-run'),
    confirm: argv.includes('--confirm'),
  };
}

function generatePassword(): string {
  return crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 12);
}

function bookToInstance(bwa: BookWithAnalysis): InstanceInput {
  const props = flattenBookAnalysis(bwa.book, bwa.analysis);
  return {
    externalId: bwa.book.id,
    label: bwa.book.title || bwa.book.id,
    properties: props as unknown as Record<string, unknown>,
    searchText: [
      props.title,
      props.tone,
      props.pace,
      ...(props.tags ?? []),
    ].filter(Boolean).join(' '),
  };
}

function bookCharacterExternalId(bookId: string, name: string): string {
  return `${bookId}::${name}`;
}

function mainCharToInstance(mc: MainCharExpanded, bookPlatformId: string): InstanceInput {
  return {
    externalId: bookCharacterExternalId(mc.book_external_id, mc.name),
    label: mc.name,
    properties: {
      name: mc.name,
      desc: mc.desc,
      role: mc.role,
    },
    relationships: { belongsTo: bookPlatformId },
    searchText: [mc.name, mc.desc].filter(Boolean).join(' '),
  };
}

function edgeExternalId(bookId: string, seq: number): string {
  return `${bookId}::edge::${seq}`;
}

function edgeToInstance(
  edge: EdgeExpanded,
  bookPlatformId: string,
  fromCharExternalId: string | null,
  toCharExternalId: string | null,
): InstanceInput {
  const resolutionStatus =
    fromCharExternalId && toCharExternalId
      ? 'fully_resolved'
      : fromCharExternalId || toCharExternalId
        ? 'partially_resolved'
        : 'unresolved';
  return {
    externalId: edgeExternalId(edge.book_external_id, edge.seq),
    label: `${edge.from_name} → ${edge.to_name}${edge.label ? ` (${edge.label})` : ''}`,
    properties: {
      from_string: edge.from_name,
      to_string: edge.to_name,
      label: edge.label,
      from_character_id: fromCharExternalId,
      to_character_id: toCharExternalId,
      resolution_status: resolutionStatus,
    },
    relationships: { belongsTo: bookPlatformId },
    searchText: [edge.from_name, edge.to_name, edge.label].filter(Boolean).join(' '),
  };
}

function plotBeatToInstance(beat: PlotBeatExpanded, bookPlatformId: string): InstanceInput {
  return {
    externalId: `${beat.book_external_id}::beat::${beat.seq}`,
    label: beat.label || `节拍 ${beat.seq + 1}`,
    properties: {
      seq: beat.seq,
      pct: beat.pct,
      label: beat.label,
      desc: beat.desc,
    },
    relationships: { belongsTo: bookPlatformId },
    searchText: [beat.label, beat.desc].filter(Boolean).join(' '),
  };
}

function emotionalPointToInstance(p: EmotionalPointExpanded, bookPlatformId: string): InstanceInput {
  return {
    externalId: `${p.book_external_id}::ep::${p.seq}`,
    label: `点 ${p.seq + 1} = ${p.value}`,
    properties: {
      seq: p.seq,
      value: p.value,
    },
    relationships: { belongsTo: bookPlatformId },
  };
}

function marketScoreToInstance(m: MarketScoreExpanded, bookPlatformId: string): InstanceInput {
  return {
    externalId: `${m.book_external_id}::ms::${m.label}`,
    label: `${m.label}: ${m.score ?? '-'}`,
    properties: {
      label: m.label,
      score: m.score,
    },
    relationships: { belongsTo: bookPlatformId },
    searchText: m.label,
  };
}

async function loadExternalIdMap(
  prisma: PrismaClient,
  tenantId: string,
  objectTypeName: string,
): Promise<Record<string, string>> {
  const rows = await prisma.objectInstance.findMany({
    where: { tenantId, objectType: objectTypeName },
    select: { id: true, externalId: true },
  });
  const out: Record<string, string> = {};
  for (const r of rows) out[r.externalId] = r.id;
  return out;
}

async function cleanupV1ObjectTypes(prisma: PrismaClient, tenantId: string): Promise<number> {
  let dropped = 0;
  for (const name of V1_OBJECT_TYPES_TO_CLEANUP) {
    const existing = await prisma.objectType.findUnique({
      where: { tenantId_name: { tenantId, name } },
    });
    if (!existing) continue;

    const instanceCount = await prisma.objectInstance.count({
      where: { tenantId, objectType: name },
    });
    if (instanceCount > 0) {
      await prisma.objectInstance.deleteMany({
        where: { tenantId, objectType: name },
      });
    }
    const rels = await prisma.objectRelationship.findMany({
      where: { tenantId, OR: [{ sourceTypeId: existing.id }, { targetTypeId: existing.id }] },
    });
    for (const r of rels) {
      await prisma.objectRelationship.delete({ where: { id: r.id } });
    }
    const registryRows = await prisma.objectTypeIndex.findMany({
      where: { tenantId, objectTypeId: existing.id },
    });
    for (const r of registryRows) {
      await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${r.indexName}"`);
    }
    await prisma.objectTypeIndex.deleteMany({ where: { tenantId, objectTypeId: existing.id } });
    await prisma.objectType.delete({ where: { id: existing.id } });
    dropped++;
    console.log(`[cleanup] dropped v1 ObjectType=${name} instances=${instanceCount}`);
  }
  return dropped;
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  if (!flags.dryRun && !flags.confirm) {
    console.error('Refusing to run. Pass --dry-run to preview, or --confirm to apply.');
    process.exit(2);
  }
  if (flags.dryRun && flags.confirm) {
    console.error('Pass either --dry-run or --confirm, not both.');
    process.exit(2);
  }

  const sourceUrl = process.env.FILM_AI_SOURCE_URL;
  const targetUrl = process.env.DATABASE_URL;
  if (!sourceUrl) {
    console.error('FILM_AI_SOURCE_URL is required.');
    process.exit(2);
  }
  if (!targetUrl) {
    console.error('DATABASE_URL is required.');
    process.exit(2);
  }

  console.log(`[start] v2 mode=${flags.dryRun ? 'dry-run' : 'confirm'} target_tenant=${FILM_AI_TENANT_SLUG}`);

  const reader = new FilmAiV2SourceReader(sourceUrl);
  console.log('[source] connecting...');
  await reader.connect();
  const booksCount = await reader.countTable('uploaded_books');
  console.log(`[source] uploaded_books rows = ${booksCount}`);
  const analysesCount = await reader.countTable('book_analyses');
  console.log(`[source] book_analyses rows = ${analysesCount}`);
  const mainChars = flags.confirm ? null : await reader.readMainCharacters();
  if (mainChars) console.log(`[source] mainChars total = ${mainChars.length}`);

  if (flags.dryRun) {
    console.log(`[plan] would ensure tenant slug=${FILM_AI_TENANT_SLUG}`);
    console.log(`[plan] would drop any existing v1 ObjectTypes from ${V1_OBJECT_TYPES_TO_CLEANUP.join(', ')}`);
    console.log(`[plan] would register ${filmAiV2OntologySpec.objectTypes.length} v2 ObjectType(s)`);
    console.log(`[plan] would upsert ${booksCount} Book instance(s) (${analysesCount} with analysis joined)`);
    console.log(`[plan] would upsert ${mainChars?.length ?? 0} BookCharacter instance(s)`);
    console.log('[plan] dry-run complete — no writes.');
    await reader.disconnect();
    return;
  }

  const prisma = new PrismaClient();
  try {
    console.log('[bootstrap] tenant + admin');
    const tenantResult = await bootstrapTenant({
      prisma,
      slug: FILM_AI_TENANT_SLUG,
      name: FILM_AI_TENANT_NAME,
      adminEmail: FILM_AI_ADMIN_EMAIL,
      generatePassword,
    });
    console.log(`[bootstrap] tenant=${tenantResult.tenantId} adminEmail=${tenantResult.adminEmail} adminCreated=${tenantResult.adminCreated}`);
    if (tenantResult.adminCreated) {
      console.log(`[bootstrap] INITIAL PASSWORD (save this): ${tenantResult.initialPassword}`);
    }

    console.log('[cleanup] dropping v1 ObjectTypes (if present)');
    const dropped = await cleanupV1ObjectTypes(prisma, tenantResult.tenantId);
    console.log(`[cleanup] v1 ObjectTypes dropped: ${dropped}`);

    console.log('[bootstrap] v2 ontology');
    const onto = await bootstrapOntology(prisma, tenantResult.tenantId, filmAiV2OntologySpec);
    console.log(`[bootstrap] objectTypes created=${onto.typesCreated} updated=${onto.typesUpdated} relationships created=${onto.relationshipsCreated}`);

    console.log('[ingest] books (uploaded_books LEFT JOIN book_analyses)');
    const booksWithAnalysis = await reader.readBooksWithAnalysis();
    const bookInstances = booksWithAnalysis.map(bookToInstance);
    const bookResult = await importInstances(prisma, tenantResult.tenantId, 'Book', bookInstances);
    console.log(`[ingest] books imported=${bookResult.imported} updated=${bookResult.updated} skipped=${bookResult.skipped}`);

    console.log('[ingest] book characters (mainChars EXPLODE)');
    const bookPlatformMap = await loadExternalIdMap(prisma, tenantResult.tenantId, 'Book');
    const mainCharRows = await reader.readMainCharacters();
    const characterInstances: InstanceInput[] = [];
    let charsSkipped = 0;
    for (const mc of mainCharRows) {
      const bookPlatformId = bookPlatformMap[mc.book_external_id];
      if (!bookPlatformId) {
        charsSkipped++;
        continue;
      }
      characterInstances.push(mainCharToInstance(mc, bookPlatformId));
    }
    const charResult = await importInstances(prisma, tenantResult.tenantId, 'BookCharacter', characterInstances);
    console.log(`[ingest] book characters imported=${charResult.imported} updated=${charResult.updated} skipped=${charResult.skipped + charsSkipped}`);

    console.log('[ingest] book character edges (entity resolution)');
    const charsByBook = new Map<string, CandidateCharacter[]>();
    for (const mc of mainCharRows) {
      const extId = bookCharacterExternalId(mc.book_external_id, mc.name);
      const list = charsByBook.get(mc.book_external_id) ?? [];
      list.push({ id: extId, name: mc.name });
      charsByBook.set(mc.book_external_id, list);
    }
    const edgeRows = await reader.readCharacterEdges();
    const edgeInstances: InstanceInput[] = [];
    let edgesSkipped = 0;
    const resStats = { fully_resolved: 0, partially_resolved: 0, unresolved: 0 };
    for (const edge of edgeRows) {
      const bookPlatformId = bookPlatformMap[edge.book_external_id];
      if (!bookPlatformId) {
        edgesSkipped++;
        continue;
      }
      const candidates = charsByBook.get(edge.book_external_id) ?? [];
      const fromId = resolveCharacterName(edge.from_name, candidates);
      const toId = resolveCharacterName(edge.to_name, candidates);
      const inst = edgeToInstance(edge, bookPlatformId, fromId, toId);
      const status = inst.properties.resolution_status as keyof typeof resStats;
      resStats[status]++;
      edgeInstances.push(inst);
    }
    const edgeResult = await importInstances(prisma, tenantResult.tenantId, 'BookCharacterEdge', edgeInstances);
    console.log(`[ingest] book character edges imported=${edgeResult.imported} updated=${edgeResult.updated} skipped=${edgeResult.skipped + edgesSkipped}`);
    console.log(`[ingest] edge resolution: fully=${resStats.fully_resolved} partially=${resStats.partially_resolved} unresolved=${resStats.unresolved}`);

    console.log('[ingest] plot beats');
    const plotBeats = await reader.readPlotBeats();
    const beatInstances: InstanceInput[] = [];
    let beatsSkipped = 0;
    for (const b of plotBeats) {
      const bookPlatformId = bookPlatformMap[b.book_external_id];
      if (!bookPlatformId) {
        beatsSkipped++;
        continue;
      }
      beatInstances.push(plotBeatToInstance(b, bookPlatformId));
    }
    const beatResult = await importInstances(prisma, tenantResult.tenantId, 'PlotBeat', beatInstances);
    console.log(`[ingest] plot beats imported=${beatResult.imported} updated=${beatResult.updated} skipped=${beatResult.skipped + beatsSkipped}`);

    console.log('[ingest] emotional curve points');
    const emoPoints = await reader.readEmotionalPoints();
    const emoInstances: InstanceInput[] = [];
    let emoSkipped = 0;
    for (const p of emoPoints) {
      const bookPlatformId = bookPlatformMap[p.book_external_id];
      if (!bookPlatformId) {
        emoSkipped++;
        continue;
      }
      emoInstances.push(emotionalPointToInstance(p, bookPlatformId));
    }
    const emoResult = await importInstances(prisma, tenantResult.tenantId, 'EmotionalCurvePoint', emoInstances);
    console.log(`[ingest] emotional curve points imported=${emoResult.imported} updated=${emoResult.updated} skipped=${emoResult.skipped + emoSkipped}`);

    console.log('[ingest] market scores');
    const marketScores = await reader.readMarketScores();
    const msInstances: InstanceInput[] = [];
    let msSkipped = 0;
    for (const m of marketScores) {
      const bookPlatformId = bookPlatformMap[m.book_external_id];
      if (!bookPlatformId) {
        msSkipped++;
        continue;
      }
      msInstances.push(marketScoreToInstance(m, bookPlatformId));
    }
    const msResult = await importInstances(prisma, tenantResult.tenantId, 'MarketScore', msInstances);
    console.log(`[ingest] market scores imported=${msResult.imported} updated=${msResult.updated} skipped=${msResult.skipped + msSkipped}`);

    console.log('[done]');
  } finally {
    await prisma.$disconnect();
    await reader.disconnect();
  }
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
