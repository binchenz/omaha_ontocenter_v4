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

export interface CharacterRelationRow {
  id: string;
  novel_id: string;
  from_char_id: string;
  to_char_id: string;
  relation_type: string | null;
  knowledge_state: string | null;
}

export interface EpisodeRow {
  id: string;
  novel_id: string;
  chapter_id: string;
  seq_order: number | null;
  content: string | null;
  summary: string | null;
  reviewer_notes: string | null;
  state_delta: unknown | null;
  version: number | null;
}

export interface ForeshadowingRow {
  id: string;
  novel_id: string;
  title: string | null;
  description: string | null;
  planted_in_episode_id: string | null;
  resolved_in_episode_id: string | null;
  status: string | null;
}

export interface TimelineEventRow {
  id: string;
  novel_id: string;
  label: string | null;
  story_time: string | null;
  seq_order: number | null;
  episode_id: string | null;
}

export interface ItemRow {
  id: string;
  novel_id: string;
  name: string | null;
  description: string | null;
  owner_id: string | null;
  location: string | null;
  status: string | null;
}

export class FilmAiSourceReader {
  private sharedClient: Client | null = null;

  constructor(private readonly connectionString: string) {}

  async connect(): Promise<void> {
    if (this.sharedClient) return;
    this.sharedClient = new Client({
      connectionString: this.connectionString,
      connectionTimeoutMillis: 15_000,
      query_timeout: 30_000,
    });
    await this.sharedClient.connect();
  }

  async disconnect(): Promise<void> {
    if (!this.sharedClient) return;
    await this.sharedClient.end();
    this.sharedClient = null;
  }

  private client(): Client {
    if (!this.sharedClient) throw new Error('FilmAiSourceReader not connected — call connect() first');
    return this.sharedClient;
  }

  async readNovels(): Promise<NovelRow[]> {
    const r = await this.client().query<NovelRow>(
      `SELECT id, user_id, title, genre, description, style_guide,
              target_word_count, target_chapter_count, created_at, updated_at
       FROM novels`,
    );
    return r.rows;
  }

  async readCharacters(): Promise<CharacterRow[]> {
    const r = await this.client().query<CharacterRow>(
      `SELECT id, novel_id, name, aliases, appearance, personality,
              motivation, secrets, arc_stage
       FROM novel_characters`,
    );
    return r.rows;
  }

  async readPlotOutlines(): Promise<PlotOutlineRow[]> {
    const r = await this.client().query<PlotOutlineRow>(
      `SELECT id, novel_id, parent_id, seq_order, title, goal,
              emotional_beat, checkpoint, content
       FROM novel_plot_outlines`,
    );
    return r.rows;
  }

  async readChapters(): Promise<ChapterRow[]> {
    const r = await this.client().query<ChapterRow>(
      `SELECT id, novel_id, outline_id, seq_order, title, status, manual_content
       FROM novel_chapters`,
    );
    return r.rows;
  }

  async readCharacterRelations(): Promise<CharacterRelationRow[]> {
    const r = await this.client().query<CharacterRelationRow>(
      `SELECT id, novel_id, from_char_id, to_char_id, relation_type, knowledge_state
       FROM novel_character_relations`,
    );
    return r.rows;
  }

  async readEpisodes(): Promise<EpisodeRow[]> {
    const r = await this.client().query<EpisodeRow>(
      `SELECT id, novel_id, chapter_id, seq_order, content, summary, reviewer_notes, state_delta, version
       FROM novel_episodes`,
    );
    return r.rows;
  }

  async readForeshadowing(): Promise<ForeshadowingRow[]> {
    const r = await this.client().query<ForeshadowingRow>(
      `SELECT id, novel_id, title, description, planted_in_episode_id, resolved_in_episode_id, status
       FROM novel_foreshadowing`,
    );
    return r.rows;
  }

  async readTimelineEvents(): Promise<TimelineEventRow[]> {
    const r = await this.client().query<TimelineEventRow>(
      `SELECT id, novel_id, label, story_time, seq_order, episode_id
       FROM novel_timeline_events`,
    );
    return r.rows;
  }

  async readItems(): Promise<ItemRow[]> {
    const r = await this.client().query<ItemRow>(
      `SELECT id, novel_id, name, description, owner_id, location, status
       FROM novel_items`,
    );
    return r.rows;
  }

  async countTable(table: string): Promise<number> {
    const r = await this.client().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public."${table}"`,
    );
    return r.rows[0]?.n ?? 0;
  }
}
