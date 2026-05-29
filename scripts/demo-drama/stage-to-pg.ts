/**
 * demo-drama: stage-to-pg
 *
 * Fetches shot breakdown data from the HTTP source and loads it into
 * a local Postgres staging schema (`drama_staging`) as two tables:
 *   - drama_staging.episodes
 *   - drama_staging.shots
 *
 * This gives the Agent a "customer database" to connect to via the
 * DataIngestionSkill's DB import flow.
 *
 * Prerequisites:
 *   - Local Postgres running (same as platform DB is fine)
 *   - DATABASE_URL in .env
 *
 * Usage:
 *   cd scripts && pnpm tsx demo-drama/stage-to-pg.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { Client } from 'pg';

const SOURCE_BASE = process.env.DRAMA_SOURCE_URL || 'http://142.202.71.28:5080';
const DATABASE_URL = process.env.DATABASE_URL;
const CONCURRENT_FETCHES = 10;

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

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

function cleanValue(v: unknown): string {
  const s = (v == null ? '' : String(v)).trim();
  if (!s || /^[-—–]+$/.test(s)) return '';
  return s;
}

async function main() {
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();

  console.log('[stage] creating schema + tables…');
  await pg.query(`CREATE SCHEMA IF NOT EXISTS drama_staging`);
  await pg.query(`DROP TABLE IF EXISTS drama_staging.shots CASCADE`);
  await pg.query(`DROP TABLE IF EXISTS drama_staging.episodes CASCADE`);

  await pg.query(`
    CREATE TABLE drama_staging.episodes (
      id TEXT PRIMARY KEY,
      series TEXT NOT NULL,
      episode_no TEXT NOT NULL,
      clip_duration NUMERIC(8,1) NOT NULL,
      shot_count INTEGER NOT NULL,
      storyline TEXT
    )
  `);

  await pg.query(`
    CREATE TABLE drama_staging.shots (
      id TEXT PRIMARY KEY,
      episode_id TEXT NOT NULL REFERENCES drama_staging.episodes(id),
      shot_num INTEGER NOT NULL,
      start_time NUMERIC(8,2) NOT NULL,
      end_time NUMERIC(8,2) NOT NULL,
      duration NUMERIC(8,2) NOT NULL,
      scene TEXT,
      shot_size TEXT,
      angle TEXT,
      movement TEXT,
      subject TEXT,
      action TEXT,
      dialogue TEXT,
      narration TEXT,
      subtitle TEXT,
      audio TEXT,
      mood TEXT
    )
  `);

  console.log('[stage] fetching manifest…');
  const manifest = await fetchJson<{ items: ManifestItem[] }>(`${SOURCE_BASE}/manifest.json`);
  console.log(`[stage]   ${manifest.items.length} episodes found`);

  let episodeCount = 0;
  let shotCount = 0;

  for (let i = 0; i < manifest.items.length; i += CONCURRENT_FETCHES) {
    const batch = manifest.items.slice(i, i + CONCURRENT_FETCHES);
    const results = await Promise.all(
      batch.map(async (item) => {
        const data = await fetchJson<ShotFile>(`${SOURCE_BASE}/shots/${item.id}.json`);
        return { item, data };
      }),
    );

    for (const { item, data } of results) {
      const storyline = (data.storyline_md || '').slice(0, 500);

      await pg.query(
        `INSERT INTO drama_staging.episodes (id, series, episode_no, clip_duration, shot_count, storyline)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET series=$2, episode_no=$3, clip_duration=$4, shot_count=$5, storyline=$6`,
        [item.id, item.series, item.episode, Math.round(item.clip_duration * 10) / 10, item.shot_count, storyline],
      );
      episodeCount++;

      for (const shot of data.shots) {
        const dur = parseFloat(shot.duration) || (shot.end_s - shot.start_s);
        const shotId = `${item.id}_${shot.shot_num}`;
        await pg.query(
          `INSERT INTO drama_staging.shots
           (id, episode_id, shot_num, start_time, end_time, duration, scene, shot_size, angle, movement, subject, action, dialogue, narration, subtitle, audio, mood)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           ON CONFLICT (id) DO NOTHING`,
          [
            shotId, item.id, shot.shot_num, shot.start_s, shot.end_s,
            Math.round(dur * 10) / 10,
            cleanValue(shot.scene), cleanValue(shot.shot_size), cleanValue(shot.angle),
            cleanValue(shot.movement), cleanValue(shot.subject), cleanValue(shot.action),
            cleanValue(shot.dialogue), cleanValue(shot.narration), cleanValue(shot.subtitle),
            cleanValue(shot.audio), cleanValue(shot.mood),
          ],
        );
        shotCount++;
      }
    }

    if ((i + CONCURRENT_FETCHES) % 50 === 0 || i + CONCURRENT_FETCHES >= manifest.items.length) {
      console.log(`[stage]   ${episodeCount} episodes, ${shotCount} shots staged`);
    }
  }

  await pg.end();
  console.log(`[stage] done. ${episodeCount} episodes + ${shotCount} shots in drama_staging.*`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
