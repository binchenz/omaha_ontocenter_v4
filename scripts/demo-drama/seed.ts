/**
 * demo-drama: seed
 *
 * Fetches shot breakdown data from the HTTP source and inserts
 * episodes + shots into the demo-drama tenant.
 *
 * Prerequisites: run setup.ts first.
 *
 * Usage:
 *   cd scripts && pnpm tsx demo-drama/seed.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { PrismaClient } from '@omaha/db';
import { ViewManagerService } from '../../apps/core-api/src/modules/ontology/view-manager.service';
import { dramaOntology } from './ontology';

const SOURCE_BASE = process.env.DRAMA_SOURCE_URL || 'http://142.202.71.28:5080';
const TENANT_SLUG = 'demo-drama';
const CHUNK_SIZE = 500;
const CONCURRENT_FETCHES = 10;

interface ManifestItem {
  id: string;
  series: string;
  episode: string;
  clip_duration: number;
  shot_count: number;
}

interface ShotRecord {
  shot_num: number;
  start_s: number;
  end_s: number;
  duration: string;
  scene: string;
  shot_size: string;
  angle: string;
  movement: string;
  subject: string;
  action: string;
  dialogue: string;
  narration: string;
  subtitle: string;
  audio: string;
  mood: string;
}

interface ShotFile {
  storyline_md?: string;
  shots: ShotRecord[];
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json() as Promise<T>;
}

async function batchFetch(items: ManifestItem[], start: number, count: number): Promise<Array<{ item: ManifestItem; data: ShotFile }>> {
  const batch = items.slice(start, start + count);
  const results = await Promise.all(
    batch.map(async (item) => {
      const data = await fetchJson<ShotFile>(`${SOURCE_BASE}/shots/${item.id}.json`);
      return { item, data };
    }),
  );
  return results;
}

function cleanValue(v: unknown): string {
  const s = (v == null ? '' : String(v)).trim();
  if (!s || /^[-—–]+$/.test(s)) return '';
  return s;
}

async function main() {
  const prisma = new PrismaClient();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: TENANT_SLUG } });
  const tenantId = tenant.id;

  console.log('[seed] fetching manifest…');
  const manifest = await fetchJson<{ items: ManifestItem[] }>(`${SOURCE_BASE}/manifest.json`);
  console.log(`[seed]   ${manifest.items.length} episodes found`);

  console.log('[seed] clearing existing instances…');
  for (const t of dramaOntology.objectTypes) {
    await prisma.objectInstance.deleteMany({ where: { tenantId, objectType: t.name } });
  }

  const episodeInstances: Array<{
    tenantId: string;
    objectType: string;
    externalId: string;
    label: string;
    properties: Record<string, unknown>;
    relationships: Record<string, unknown>;
    searchText: string;
  }> = [];

  const shotInstances: Array<{
    tenantId: string;
    objectType: string;
    externalId: string;
    label: string;
    properties: Record<string, unknown>;
    relationships: Record<string, unknown>;
    searchText: string;
  }> = [];

  let processed = 0;
  for (let i = 0; i < manifest.items.length; i += CONCURRENT_FETCHES) {
    const batch = await batchFetch(manifest.items, i, CONCURRENT_FETCHES);

    for (const { item, data } of batch) {
      const episodeExtId = item.id;
      const storyline = (data.storyline_md || '').slice(0, 500);

      episodeInstances.push({
        tenantId,
        objectType: 'episode',
        externalId: episodeExtId,
        label: `${item.series} - ${item.episode}`,
        properties: {
          series: item.series,
          episodeNo: item.episode,
          clipDuration: Math.round(item.clip_duration * 10) / 10,
          shotCount: item.shot_count,
          storyline,
        },
        relationships: {},
        searchText: `${item.series} ${item.episode}`,
      });

      for (const shot of data.shots) {
        const dur = parseFloat(shot.duration) || (shot.end_s - shot.start_s);
        shotInstances.push({
          tenantId,
          objectType: 'shot',
          externalId: `${episodeExtId}_${shot.shot_num}`,
          label: `${item.series} ${item.episode} #${shot.shot_num}`,
          properties: {
            shotNum: shot.shot_num,
            startTime: shot.start_s,
            endTime: shot.end_s,
            duration: Math.round(dur * 10) / 10,
            scene: cleanValue(shot.scene),
            shotSize: cleanValue(shot.shot_size),
            angle: cleanValue(shot.angle),
            movement: cleanValue(shot.movement),
            subject: cleanValue(shot.subject),
            action: cleanValue(shot.action),
            dialogue: cleanValue(shot.dialogue),
            narration: cleanValue(shot.narration),
            subtitle: cleanValue(shot.subtitle),
            audio: cleanValue(shot.audio),
            mood: cleanValue(shot.mood),
          },
          relationships: { episode_shots: episodeExtId },
          searchText: `${cleanValue(shot.scene)} ${cleanValue(shot.subject)} ${cleanValue(shot.dialogue)}`,
        });
      }
    }

    processed += batch.length;
    if (processed % 50 === 0 || processed === manifest.items.length) {
      console.log(`[seed]   fetched ${processed}/${manifest.items.length} episodes (${shotInstances.length} shots)`);
    }
  }

  // Bulk insert episodes
  console.log(`[seed] inserting ${episodeInstances.length} episodes…`);
  for (let i = 0; i < episodeInstances.length; i += CHUNK_SIZE) {
    await prisma.objectInstance.createMany({ data: episodeInstances.slice(i, i + CHUNK_SIZE), skipDuplicates: true });
  }

  // Bulk insert shots
  console.log(`[seed] inserting ${shotInstances.length} shots…`);
  for (let i = 0; i < shotInstances.length; i += CHUNK_SIZE) {
    await prisma.objectInstance.createMany({ data: shotInstances.slice(i, i + CHUNK_SIZE), skipDuplicates: true });
    if ((i + CHUNK_SIZE) % 5000 === 0) {
      console.log(`[seed]   ${Math.min(i + CHUNK_SIZE, shotInstances.length)}/${shotInstances.length} shots inserted`);
    }
  }

  // Refresh materialized views
  console.log('[seed] refreshing materialized views…');
  const viewManager = new ViewManagerService(prisma as any);
  for (const t of dramaOntology.objectTypes) {
    await viewManager.refresh(tenantId, t.name);
    console.log(`[seed]   refreshed mv_${t.name}`);
  }

  await prisma.$disconnect();
  console.log(`[seed] done. ${episodeInstances.length} episodes + ${shotInstances.length} shots.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
