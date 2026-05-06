export interface UploadedBookRow {
  id: string;
  user_id: string | null;
  title: string;
  file_hash: string | null;
  file_path: string | null;
  total_chars: number | null;
  chapter_count: number | null;
  status: string | null;
  created_at: Date | null;
  task_token: string | null;
}

export interface BookAnalysisRow {
  id: string;
  source_type: string;
  source_id: string;
  analysis_mode: string | null;
  data_completeness: number | null;
  overall_score: number | null;
  adaptation_score: number | null;
  plot_structure: any;
  character_network: any;
  emotional_curve: any;
  theme_mining: any;
  market_potential: any;
  ip_scout_report: string | null;
  writer_study_report: string | null;
  task_id: string | null;
  created_at: Date | null;
  completed_at: Date | null;
}

export interface FlatBookProperties {
  title: string;
  user_id: string | null;
  total_chars: number | null;
  chapter_count: number | null;
  status: string | null;
  created_at: string | null;

  overall_score: number | null;
  adaptation_score: number | null;
  data_completeness: number | null;
  analysis_mode: string | null;

  tags: string[] | null;
  tone: string | null;
  pace: string | null;
  pov: string | null;
  sentence: string | null;

  market_overall: number | null;
  market_comparison: string | null;

  pace_type: string | null;
  avg_tension: number | null;
  peak_chapter: string | null;

  structure_template: string | null;
  structure_type: string | null;
}

export function flattenBookAnalysis(
  book: UploadedBookRow,
  analysis: BookAnalysisRow | null,
): FlatBookProperties {
  const tm = analysis?.theme_mining ?? null;
  const ec = analysis?.emotional_curve ?? null;
  const mp = analysis?.market_potential ?? null;
  const ps = analysis?.plot_structure ?? null;

  return {
    title: book.title,
    user_id: book.user_id,
    total_chars: book.total_chars,
    chapter_count: book.chapter_count,
    status: book.status,
    created_at: book.created_at?.toISOString?.() ?? null,

    overall_score: numOrNull(analysis?.overall_score),
    adaptation_score: numOrNull(analysis?.adaptation_score),
    data_completeness: numOrNull(analysis?.data_completeness),
    analysis_mode: analysis?.analysis_mode ?? null,

    tags: Array.isArray(tm?.tags) ? tm.tags : null,
    tone: tm?.tone ?? null,
    pace: tm?.pace ?? null,
    pov: tm?.pov ?? null,
    sentence: tm?.sentence ?? null,

    market_overall: numOrNull(mp?.overall),
    market_comparison: mp?.comparison ?? null,

    pace_type: ec?.paceType ?? null,
    avg_tension: numOrNull(ec?.avgTension),
    peak_chapter: ec?.peakChapter ?? null,

    structure_template: ps?.template ?? null,
    structure_type: ps?.structureType ?? null,
  };
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
