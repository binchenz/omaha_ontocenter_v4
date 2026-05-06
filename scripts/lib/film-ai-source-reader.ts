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

export interface PlotOutlineRow {
  id: string;
  novel_id: string;
  parent_id: string | null;
  seq_order: number | null;
  title: string | null;
  goal: string | null;
  emotional_beat: string | null;
  checkpoint: boolean | null;
  content: string | null;
}

export interface ChapterRow {
  id: string;
  novel_id: string;
  outline_id: string | null;
  seq_order: number | null;
  title: string | null;
  status: string | null;
  manual_content: string | null;
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

  async readPlotOutlines(): Promise<PlotOutlineRow[]> {
    return this.withClient(async (c) => {
      const r = await c.query<PlotOutlineRow>(
        `SELECT id, novel_id, parent_id, seq_order, title, goal,
                emotional_beat, checkpoint, content
         FROM novel_plot_outlines`,
      );
      return r.rows;
    });
  }

  async readChapters(): Promise<ChapterRow[]> {
    return this.withClient(async (c) => {
      const r = await c.query<ChapterRow>(
        `SELECT id, novel_id, outline_id, seq_order, title, status, manual_content
         FROM novel_chapters`,
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
