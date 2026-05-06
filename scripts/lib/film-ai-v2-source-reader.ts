import { Client } from 'pg';
import type { UploadedBookRow, BookAnalysisRow } from './book-analysis-flattener';

export interface BookWithAnalysis {
  book: UploadedBookRow;
  analysis: BookAnalysisRow | null;
}

export interface MainCharExpanded {
  book_external_id: string;
  name: string;
  desc: string | null;
  role: string | null;
}

export interface EdgeExpanded {
  book_external_id: string;
  seq: number;
  from_name: string;
  to_name: string;
  label: string | null;
}

export interface PlotBeatExpanded {
  book_external_id: string;
  seq: number;
  pct: number | null;
  label: string | null;
  desc: string | null;
}

export interface EmotionalPointExpanded {
  book_external_id: string;
  seq: number;
  value: number;
}

export interface MarketScoreExpanded {
  book_external_id: string;
  label: string;
  score: number | null;
}

export interface ChapterSummaryRow {
  id: string;
  source_id: string;
  chapter_seq: number | null;
  chapter_title: string | null;
  structured_summary: any;
}

export class FilmAiV2SourceReader {
  private client: Client | null = null;

  constructor(private readonly connectionString: string) {}

  async connect(): Promise<void> {
    if (this.client) return;
    this.client = new Client({
      connectionString: this.connectionString,
      connectionTimeoutMillis: 15_000,
      query_timeout: 300_000,
      statement_timeout: 300_000,
    });
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    if (!this.client) return;
    await this.client.end();
    this.client = null;
  }

  private c(): Client {
    if (!this.client) throw new Error('Not connected. Call connect() first.');
    return this.client;
  }

  async readBooksWithAnalysis(): Promise<BookWithAnalysis[]> {
    const books = await this.c().query<UploadedBookRow>(
      `SELECT id, user_id, title, file_hash, file_path, total_chars, chapter_count, status, created_at, task_token FROM uploaded_books`,
    );
    const analyses = await this.c().query<BookAnalysisRow>(
      `SELECT id, source_type, source_id, analysis_mode, data_completeness,
              overall_score, adaptation_score, plot_structure, character_network,
              emotional_curve, theme_mining, market_potential, ip_scout_report,
              writer_study_report, task_id, created_at, completed_at
       FROM book_analyses WHERE source_type = 'uploaded'`,
    );
    const analysisBySourceId = new Map<string, BookAnalysisRow>();
    for (const a of analyses.rows) analysisBySourceId.set(a.source_id, a);

    return books.rows.map((b) => ({
      book: b,
      analysis: analysisBySourceId.get(b.id) ?? null,
    }));
  }

  async readMainCharacters(): Promise<MainCharExpanded[]> {
    const r = await this.c().query<{ book_external_id: string; mc: any }>(
      `SELECT ba.source_id AS book_external_id, mc
       FROM book_analyses ba,
            jsonb_array_elements(ba.character_network->'mainChars') mc
       WHERE ba.source_type = 'uploaded'
         AND ba.character_network->'mainChars' IS NOT NULL
         AND jsonb_typeof(ba.character_network->'mainChars') = 'array'`,
    );
    return r.rows
      .filter((row) => row.mc && typeof row.mc === 'object' && row.mc.name)
      .map((row) => ({
        book_external_id: row.book_external_id,
        name: String(row.mc.name),
        desc: row.mc.desc ?? null,
        role: row.mc.role ?? null,
      }));
  }

  async readCharacterEdges(): Promise<EdgeExpanded[]> {
    const r = await this.c().query<{ book_external_id: string; ord: number; edge: any }>(
      `SELECT ba.source_id AS book_external_id,
              (ord - 1)::int AS ord,
              edge
       FROM book_analyses ba,
            jsonb_array_elements(ba.character_network->'edges') WITH ORDINALITY AS t(edge, ord)
       WHERE ba.source_type = 'uploaded'
         AND ba.character_network->'edges' IS NOT NULL
         AND jsonb_typeof(ba.character_network->'edges') = 'array'`,
    );
    return r.rows
      .filter((row) => row.edge && typeof row.edge === 'object' && row.edge.from && row.edge.to)
      .map((row) => ({
        book_external_id: row.book_external_id,
        seq: row.ord,
        from_name: String(row.edge.from),
        to_name: String(row.edge.to),
        label: row.edge.label ?? null,
      }));
  }

  async readPlotBeats(): Promise<PlotBeatExpanded[]> {
    const r = await this.c().query<{ book_external_id: string; ord: number; beat: any }>(
      `SELECT ba.source_id AS book_external_id,
              (ord - 1)::int AS ord,
              beat
       FROM book_analyses ba,
            jsonb_array_elements(ba.plot_structure->'beats') WITH ORDINALITY AS t(beat, ord)
       WHERE ba.source_type = 'uploaded'
         AND ba.plot_structure->'beats' IS NOT NULL
         AND jsonb_typeof(ba.plot_structure->'beats') = 'array'`,
    );
    return r.rows
      .filter((row) => row.beat && typeof row.beat === 'object')
      .map((row) => ({
        book_external_id: row.book_external_id,
        seq: row.ord,
        pct: row.beat.pct ?? null,
        label: row.beat.label ?? null,
        desc: row.beat.desc ?? null,
      }));
  }

  async readEmotionalPoints(): Promise<EmotionalPointExpanded[]> {
    const r = await this.c().query<{ book_external_id: string; ord: number; v: number | string }>(
      `SELECT ba.source_id AS book_external_id,
              (ord - 1)::int AS ord,
              v::text AS v
       FROM book_analyses ba,
            jsonb_array_elements(ba.emotional_curve->'points') WITH ORDINALITY AS t(v, ord)
       WHERE ba.source_type = 'uploaded'
         AND ba.emotional_curve->'points' IS NOT NULL
         AND jsonb_typeof(ba.emotional_curve->'points') = 'array'`,
    );
    return r.rows
      .map((row) => ({
        book_external_id: row.book_external_id,
        seq: row.ord,
        value: Number(row.v),
      }))
      .filter((p) => Number.isFinite(p.value));
  }

  async readMarketScores(): Promise<MarketScoreExpanded[]> {
    const r = await this.c().query<{ book_external_id: string; score: any }>(
      `SELECT ba.source_id AS book_external_id, score
       FROM book_analyses ba,
            jsonb_array_elements(ba.market_potential->'scores') score
       WHERE ba.source_type = 'uploaded'
         AND ba.market_potential->'scores' IS NOT NULL
         AND jsonb_typeof(ba.market_potential->'scores') = 'array'`,
    );
    return r.rows
      .filter((row) => row.score && typeof row.score === 'object' && row.score.label)
      .map((row) => ({
        book_external_id: row.book_external_id,
        label: String(row.score.label),
        score: row.score.score !== undefined && row.score.score !== null ? Number(row.score.score) : null,
      }));
  }

  async readChapterSummaries(): Promise<ChapterSummaryRow[]> {
    const r = await this.c().query<ChapterSummaryRow>(
      `SELECT cs.id, cs.source_id, cs.chapter_seq, cs.chapter_title, cs.structured_summary
       FROM chapter_summaries cs
       WHERE cs.source_type = 'uploaded'`,
    );
    return r.rows;
  }

  async countTable(table: string): Promise<number> {
    const r = await this.c().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public."${table}"`,
    );
    return r.rows[0]?.n ?? 0;
  }
}
