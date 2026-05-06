import * as path from 'path';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@omaha/db';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { bootstrapTenant } from './lib/tenant-bootstrap';
import { bootstrapOntology } from './lib/ontology-bootstrap';
import { importInstances, type InstanceInput } from './lib/object-instance-importer';
import {
  FilmAiSourceReader,
  type NovelRow,
  type CharacterRow,
  type PlotOutlineRow,
  type ChapterRow,
  type CharacterRelationRow,
  type EpisodeRow,
  type ForeshadowingRow,
  type TimelineEventRow,
  type ItemRow,
} from './lib/film-ai-source-reader';
import { applyFkRelationships, type TargetTableLookup } from './lib/fk-to-relationships';
import {
  FILM_AI_TENANT_SLUG,
  FILM_AI_TENANT_NAME,
  FILM_AI_ADMIN_EMAIL,
  filmAiOntologySpec,
  filmAiFkSpec,
} from './lib/film-ai-ontology-spec';

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

function novelToInstance(row: NovelRow): InstanceInput {
  return {
    externalId: row.id,
    label: row.title || row.id,
    properties: {
      title: row.title,
      genre: row.genre,
      description: row.description,
      style_guide: row.style_guide,
      target_word_count: row.target_word_count,
      target_chapter_count: row.target_chapter_count,
      author_user_id: row.user_id,
      created_at: row.created_at?.toISOString?.() ?? null,
      updated_at: row.updated_at?.toISOString?.() ?? null,
    },
    searchText: [row.title, row.genre, row.description].filter(Boolean).join(' '),
  };
}

function characterToInstance(row: CharacterRow, relationships: Record<string, string>): InstanceInput {
  return {
    externalId: row.id,
    label: row.name || row.id,
    properties: {
      name: row.name,
      aliases: row.aliases ?? [],
      appearance: row.appearance,
      personality: row.personality,
      motivation: row.motivation,
      secrets: row.secrets,
      arc_stage: row.arc_stage,
    },
    relationships,
    searchText: [row.name, ...(row.aliases ?? [])].filter(Boolean).join(' '),
  };
}

function plotOutlineToInstance(row: PlotOutlineRow, relationships: Record<string, string>): InstanceInput {
  return {
    externalId: row.id,
    label: row.title || row.id,
    properties: {
      seq_order: row.seq_order,
      title: row.title,
      goal: row.goal,
      emotional_beat: row.emotional_beat,
      checkpoint: row.checkpoint,
      content: row.content,
    },
    relationships,
    searchText: [row.title, row.goal].filter(Boolean).join(' '),
  };
}

function chapterToInstance(row: ChapterRow, relationships: Record<string, string>): InstanceInput {
  return {
    externalId: row.id,
    label: row.title || row.id,
    properties: {
      seq_order: row.seq_order,
      title: row.title,
      status: row.status,
      manual_content: row.manual_content,
    },
    relationships,
    searchText: [row.title].filter(Boolean).join(' '),
  };
}

function characterRelationToInstance(row: CharacterRelationRow, relationships: Record<string, string>): InstanceInput {
  return {
    externalId: row.id,
    label: row.relation_type || row.id,
    properties: {
      relation_type: row.relation_type,
      knowledge_state: row.knowledge_state,
    },
    relationships,
    searchText: [row.relation_type, row.knowledge_state].filter(Boolean).join(' '),
  };
}

function episodeToInstance(row: EpisodeRow, relationships: Record<string, string>): InstanceInput {
  return {
    externalId: row.id,
    label: row.summary || `Episode ${row.seq_order ?? ''}`.trim() || row.id,
    properties: {
      seq_order: row.seq_order,
      content: row.content,
      summary: row.summary,
      reviewer_notes: row.reviewer_notes,
      state_delta: row.state_delta,
      version: row.version,
    },
    relationships,
    searchText: [row.summary, row.content].filter(Boolean).join(' ').slice(0, 500),
  };
}

function foreshadowingToInstance(row: ForeshadowingRow, relationships: Record<string, string>): InstanceInput {
  return {
    externalId: row.id,
    label: row.title || row.id,
    properties: {
      title: row.title,
      description: row.description,
      status: row.status,
    },
    relationships,
    searchText: [row.title, row.description].filter(Boolean).join(' '),
  };
}

function timelineEventToInstance(row: TimelineEventRow, relationships: Record<string, string>): InstanceInput {
  return {
    externalId: row.id,
    label: row.label || row.id,
    properties: {
      label: row.label,
      story_time: row.story_time,
      seq_order: row.seq_order,
    },
    relationships,
    searchText: [row.label, row.story_time].filter(Boolean).join(' '),
  };
}

function itemToInstance(row: ItemRow, relationships: Record<string, string>): InstanceInput {
  return {
    externalId: row.id,
    label: row.name || row.id,
    properties: {
      name: row.name,
      description: row.description,
      location: row.location,
      status: row.status,
    },
    relationships,
    searchText: [row.name, row.description, row.location].filter(Boolean).join(' '),
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

  console.log(`[start] mode=${flags.dryRun ? 'dry-run' : 'confirm'} target_tenant=${FILM_AI_TENANT_SLUG}`);

  const reader = new FilmAiSourceReader(sourceUrl);
  console.log('[source] connecting and counting...');
  await reader.connect();
  const novelCount = await reader.countTable('novels');
  console.log(`[source] novels rows = ${novelCount}`);
  const characterCount = await reader.countTable('novel_characters');
  console.log(`[source] novel_characters rows = ${characterCount}`);
  const plotOutlineCount = await reader.countTable('novel_plot_outlines');
  console.log(`[source] novel_plot_outlines rows = ${plotOutlineCount}`);
  const chapterCount = await reader.countTable('novel_chapters');
  console.log(`[source] novel_chapters rows = ${chapterCount}`);
  const characterRelationCount = await reader.countTable('novel_character_relations');
  console.log(`[source] novel_character_relations rows = ${characterRelationCount}`);
  const episodeCount = await reader.countTable('novel_episodes');
  console.log(`[source] novel_episodes rows = ${episodeCount}`);
  const foreshadowingCount = await reader.countTable('novel_foreshadowing');
  console.log(`[source] novel_foreshadowing rows = ${foreshadowingCount}`);
  const timelineEventCount = await reader.countTable('novel_timeline_events');
  console.log(`[source] novel_timeline_events rows = ${timelineEventCount}`);
  const itemCount = await reader.countTable('novel_items');
  console.log(`[source] novel_items rows = ${itemCount}`);

  if (flags.dryRun) {
    console.log(`[plan] would upsert tenant slug=${FILM_AI_TENANT_SLUG}`);
    console.log(`[plan] would register ${filmAiOntologySpec.objectTypes.length} ObjectType(s), ${filmAiOntologySpec.relationships.length} Relationship(s)`);
    console.log(`[plan] would upsert ${novelCount} Novel instance(s)`);
    console.log(`[plan] would upsert ${characterCount} Character instance(s)`);
    console.log(`[plan] would upsert ${plotOutlineCount} PlotOutline instance(s)`);
    console.log(`[plan] would upsert ${chapterCount} Chapter instance(s)`);
    console.log(`[plan] would upsert ${characterRelationCount} CharacterRelation instance(s)`);
    console.log(`[plan] would upsert ${episodeCount} Episode instance(s)`);
    console.log(`[plan] would upsert ${foreshadowingCount} Foreshadowing instance(s)`);
    console.log(`[plan] would upsert ${timelineEventCount} TimelineEvent instance(s)`);
    console.log(`[plan] would upsert ${itemCount} Item instance(s)`);
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

    console.log('[bootstrap] ontology');
    const onto = await bootstrapOntology(prisma, tenantResult.tenantId, filmAiOntologySpec);
    console.log(`[bootstrap] objectTypes created=${onto.typesCreated} updated=${onto.typesUpdated} relationships created=${onto.relationshipsCreated}`);

    console.log('[ingest] novels');
    const novels = await reader.readNovels();
    const novelInstances = novels.map(novelToInstance);
    const novelResult = await importInstances(prisma, tenantResult.tenantId, 'Novel', novelInstances);
    console.log(`[ingest] novels imported=${novelResult.imported} updated=${novelResult.updated} skipped=${novelResult.skipped}`);

    console.log('[ingest] characters');
    const novelMap = await loadExternalIdMap(prisma, tenantResult.tenantId, 'Novel');
    const characterLookup: TargetTableLookup = { novels: novelMap };
    const characters = await reader.readCharacters();
    const enrichedChars = applyFkRelationships('novel_characters', characters, filmAiFkSpec, characterLookup);
    const characterInstances = enrichedChars.map((e) => characterToInstance(e.row, e.relationships));
    const characterResult = await importInstances(prisma, tenantResult.tenantId, 'Character', characterInstances);
    console.log(`[ingest] characters imported=${characterResult.imported} updated=${characterResult.updated} skipped=${characterResult.skipped}`);

    console.log('[ingest] plot outlines (pass 1: rows without parent FK)');
    const plotOutlines = await reader.readPlotOutlines();
    const passOneSpec = filmAiFkSpec.filter(
      (s) => !(s.sourceTable === 'novel_plot_outlines' && s.sourceColumn === 'parent_id'),
    );
    const enrichedPlotOutlinesPass1 = applyFkRelationships(
      'novel_plot_outlines',
      plotOutlines,
      passOneSpec,
      { novels: novelMap },
    );
    const plotOutlineInstancesPass1 = enrichedPlotOutlinesPass1.map((e) =>
      plotOutlineToInstance(e.row, e.relationships),
    );
    const poPass1Result = await importInstances(
      prisma,
      tenantResult.tenantId,
      'PlotOutline',
      plotOutlineInstancesPass1,
    );
    console.log(
      `[ingest] plot outlines pass 1 imported=${poPass1Result.imported} updated=${poPass1Result.updated} skipped=${poPass1Result.skipped}`,
    );

    console.log('[ingest] plot outlines (pass 2: parent FK)');
    const plotOutlineMap = await loadExternalIdMap(prisma, tenantResult.tenantId, 'PlotOutline');
    const enrichedPlotOutlinesPass2 = applyFkRelationships(
      'novel_plot_outlines',
      plotOutlines,
      filmAiFkSpec,
      { novels: novelMap, novel_plot_outlines: plotOutlineMap },
    );
    const plotOutlineInstancesPass2 = enrichedPlotOutlinesPass2.map((e) =>
      plotOutlineToInstance(e.row, e.relationships),
    );
    const poPass2Result = await importInstances(
      prisma,
      tenantResult.tenantId,
      'PlotOutline',
      plotOutlineInstancesPass2,
    );
    console.log(
      `[ingest] plot outlines pass 2 imported=${poPass2Result.imported} updated=${poPass2Result.updated} skipped=${poPass2Result.skipped}`,
    );

    console.log('[ingest] chapters');
    const chapters = await reader.readChapters();
    const chapterLookup: TargetTableLookup = { novels: novelMap, novel_plot_outlines: plotOutlineMap };
    const enrichedChapters = applyFkRelationships('novel_chapters', chapters, filmAiFkSpec, chapterLookup);
    const chapterInstances = enrichedChapters.map((e) => chapterToInstance(e.row, e.relationships));
    const chapterResult = await importInstances(prisma, tenantResult.tenantId, 'Chapter', chapterInstances);
    console.log(`[ingest] chapters imported=${chapterResult.imported} updated=${chapterResult.updated} skipped=${chapterResult.skipped}`);

    console.log('[ingest] character relations');
    const characterMap = await loadExternalIdMap(prisma, tenantResult.tenantId, 'Character');
    const characterRelations = await reader.readCharacterRelations();
    const enrichedCRs = applyFkRelationships(
      'novel_character_relations',
      characterRelations,
      filmAiFkSpec,
      { novels: novelMap, novel_characters: characterMap },
    );
    const crInstances = enrichedCRs.map((e) => characterRelationToInstance(e.row, e.relationships));
    const crResult = await importInstances(prisma, tenantResult.tenantId, 'CharacterRelation', crInstances);
    console.log(`[ingest] character relations imported=${crResult.imported} updated=${crResult.updated} skipped=${crResult.skipped}`);

    console.log('[ingest] episodes');
    const chapterMap = await loadExternalIdMap(prisma, tenantResult.tenantId, 'Chapter');
    const episodes = await reader.readEpisodes();
    const enrichedEps = applyFkRelationships(
      'novel_episodes',
      episodes,
      filmAiFkSpec,
      { novels: novelMap, novel_chapters: chapterMap },
    );
    const episodeInstances = enrichedEps.map((e) => episodeToInstance(e.row, e.relationships));
    const episodeResult = await importInstances(prisma, tenantResult.tenantId, 'Episode', episodeInstances);
    console.log(`[ingest] episodes imported=${episodeResult.imported} updated=${episodeResult.updated} skipped=${episodeResult.skipped}`);

    console.log('[ingest] foreshadowing');
    const episodeMap = await loadExternalIdMap(prisma, tenantResult.tenantId, 'Episode');
    const foreshadowing = await reader.readForeshadowing();
    const enrichedFs = applyFkRelationships(
      'novel_foreshadowing',
      foreshadowing,
      filmAiFkSpec,
      { novels: novelMap, novel_episodes: episodeMap },
    );
    const fsInstances = enrichedFs.map((e) => foreshadowingToInstance(e.row, e.relationships));
    const fsResult = await importInstances(prisma, tenantResult.tenantId, 'Foreshadowing', fsInstances);
    console.log(`[ingest] foreshadowing imported=${fsResult.imported} updated=${fsResult.updated} skipped=${fsResult.skipped}`);

    console.log('[ingest] timeline events');
    const timelineEvents = await reader.readTimelineEvents();
    const enrichedTEs = applyFkRelationships(
      'novel_timeline_events',
      timelineEvents,
      filmAiFkSpec,
      { novels: novelMap, novel_episodes: episodeMap },
    );
    const teInstances = enrichedTEs.map((e) => timelineEventToInstance(e.row, e.relationships));
    const teResult = await importInstances(prisma, tenantResult.tenantId, 'TimelineEvent', teInstances);
    console.log(`[ingest] timeline events imported=${teResult.imported} updated=${teResult.updated} skipped=${teResult.skipped}`);

    console.log('[ingest] items');
    const items = await reader.readItems();
    const enrichedItems = applyFkRelationships(
      'novel_items',
      items,
      filmAiFkSpec,
      { novels: novelMap, novel_characters: characterMap },
    );
    const itemInstances = enrichedItems.map((e) => itemToInstance(e.row, e.relationships));
    const itemResult = await importInstances(prisma, tenantResult.tenantId, 'Item', itemInstances);
    console.log(`[ingest] items imported=${itemResult.imported} updated=${itemResult.updated} skipped=${itemResult.skipped}`);

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
