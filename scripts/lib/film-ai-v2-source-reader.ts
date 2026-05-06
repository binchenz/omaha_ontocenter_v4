import { Client } from 'pg';
import type { UploadedBookRow, BookAnalysisRow } from './book-analysis-flattener';

export interface BookWithAnalysis {
  book: UploadedBookRow;
  analysis: BookAnalysisRow | null;
}

export class FilmAiV2SourceReader {
  private client: Client | null = null;

  constructor(private readonly connectionString: string) {}

  async connect(): Promise<void> {
    if (this.client) return;
    this.client = new Client({
      connectionString: this.connectionString,
      connectionTimeoutMillis: 15_000,
      query_timeout: 60_000,
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

  async countTable(table: string): Promise<number> {
    const r = await this.c().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public."${table}"`,
    );
    return r.rows[0]?.n ?? 0;
  }
}
