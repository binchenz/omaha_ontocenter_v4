import { Client } from 'pg';

export interface NovelRow {
  id: string;
  user_id: string | null;
  title: string;
  genre: string | null;
  description: string | null;
  style_guide: string | null;
  target_word_count: number | null;
  target_chapter_count: number | null;
  created_at: Date | null;
  updated_at: Date | null;
}

export interface CharacterRow {
  id: string;
  novel_id: string;
  name: string;
  aliases: string[] | null;
  appearance: string | null;
  personality: string | null;
  motivation: string | null;
  secrets: string | null;
  arc_stage: string | null;
}

export class FilmAiSourceReader {
  constructor(private readonly connectionString: string) {}

  async withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: this.connectionString, connectionTimeoutMillis: 10_000 });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  }

  async readNovels(): Promise<NovelRow[]> {
    return this.withClient(async (c) => {
      const r = await c.query<NovelRow>(
        `SELECT id, user_id, title, genre, description, style_guide,
                target_word_count, target_chapter_count, created_at, updated_at
         FROM novels`,
      );
      return r.rows;
    });
  }

  async readCharacters(): Promise<CharacterRow[]> {
    return this.withClient(async (c) => {
      const r = await c.query<CharacterRow>(
        `SELECT id, novel_id, name, aliases, appearance, personality,
                motivation, secrets, arc_stage
         FROM novel_characters`,
      );
      return r.rows;
    });
  }

  async countTable(table: string): Promise<number> {
    return this.withClient(async (c) => {
      const r = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM public."${table}"`);
      return r.rows[0]?.n ?? 0;
    });
  }
}
