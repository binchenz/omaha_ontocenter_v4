import * as path from 'path';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@omaha/db';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { bootstrapTenant } from './lib/tenant-bootstrap';
import { bootstrapOntology } from './lib/ontology-bootstrap';
import { importInstances, type InstanceInput } from './lib/object-instance-importer';
import { FilmAiSourceReader, type NovelRow, type CharacterRow } from './lib/film-ai-source-reader';
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
  const novelCount = await reader.countTable('novels');
  console.log(`[source] novels rows = ${novelCount}`);
  const characterCount = await reader.countTable('novel_characters');
  console.log(`[source] novel_characters rows = ${characterCount}`);

  if (flags.dryRun) {
    console.log(`[plan] would upsert tenant slug=${FILM_AI_TENANT_SLUG}`);
    console.log(`[plan] would register ${filmAiOntologySpec.objectTypes.length} ObjectType(s), ${filmAiOntologySpec.relationships.length} Relationship(s)`);
    console.log(`[plan] would upsert ${novelCount} Novel instance(s)`);
    console.log(`[plan] would upsert ${characterCount} Character instance(s)`);
    console.log('[plan] dry-run complete — no writes.');
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
    const lookup: TargetTableLookup = { novels: novelMap };
    const characters = await reader.readCharacters();
    const enriched = applyFkRelationships('novel_characters', characters, filmAiFkSpec, lookup);
    const characterInstances = enriched.map((e) => characterToInstance(e.row, e.relationships));
    const characterResult = await importInstances(prisma, tenantResult.tenantId, 'Character', characterInstances);
    console.log(`[ingest] characters imported=${characterResult.imported} updated=${characterResult.updated} skipped=${characterResult.skipped}`);

    console.log('[done]');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
