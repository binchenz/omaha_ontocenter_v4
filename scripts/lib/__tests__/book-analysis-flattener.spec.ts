import { describe, it, expect } from 'vitest';
import { flattenBookAnalysis, type UploadedBookRow, type BookAnalysisRow } from '../book-analysis-flattener';

const makeBook = (overrides: Partial<UploadedBookRow> = {}): UploadedBookRow => ({
  id: 'book-1',
  user_id: 'u-1',
  title: '测试小说',
  file_hash: null,
  file_path: null,
  total_chars: 100000,
  chapter_count: 50,
  status: 'completed',
  created_at: new Date('2026-01-01'),
  task_token: null,
  ...overrides,
});

const makeAnalysis = (overrides: Partial<BookAnalysisRow> = {}): BookAnalysisRow => ({
  id: 'ba-1',
  source_type: 'uploaded',
  source_id: 'book-1',
  analysis_mode: 'full',
  data_completeness: 0.95,
  overall_score: 87,
  adaptation_score: 82,
  plot_structure: {
    beats: [{ pct: 5, label: '低谷起点', desc: '主角出场' }],
    template: '六幕结构',
    structureType: '日常→种田→收服→远征→危机→决战',
  },
  character_network: {
    mainChars: [{ name: '陆阳', desc: '主角', role: '主角', roleColor: 'bg-blue-500/15 text-blue-400' }],
    edges: [{ from: '陆阳', to: '云芝', label: '师徒' }],
    nodes: [{ x: 200, y: 150, id: '陆阳', role: '主角' }],
  },
  emotional_curve: {
    points: [30, 40, 50, 60],
    paceType: '高密度爽文型',
    avgTension: 60,
    peakChapter: '第186章',
  },
  theme_mining: {
    pov: '第三人称全知',
    pace: '快节奏',
    tags: ['修仙', '搞笑', '反套路'],
    tone: '轻松搞笑',
    sentence: '口语化',
  },
  market_potential: {
    scores: [
      { color: 'bg-blue-400', label: '剧情吸引力', score: 85 },
      { color: 'bg-green-400', label: '角色塑造', score: 90 },
    ],
    overall: 87,
    comparison: '超越平台同期 Top 10 平均水平',
  },
  ip_scout_report: null,
  writer_study_report: null,
  task_id: null,
  created_at: new Date('2026-01-01'),
  completed_at: null,
  ...overrides,
});

describe('flattenBookAnalysis', () => {
  it('extracts flat properties from a full book + analysis pair', () => {
    const result = flattenBookAnalysis(makeBook(), makeAnalysis());
    expect(result.title).toBe('测试小说');
    expect(result.total_chars).toBe(100000);
    expect(result.chapter_count).toBe(50);
    expect(result.overall_score).toBe(87);
    expect(result.adaptation_score).toBe(82);
    expect(result.tags).toEqual(['修仙', '搞笑', '反套路']);
    expect(result.tone).toBe('轻松搞笑');
    expect(result.pace).toBe('快节奏');
    expect(result.pov).toBe('第三人称全知');
    expect(result.sentence).toBe('口语化');
    expect(result.market_overall).toBe(87);
    expect(result.market_comparison).toBe('超越平台同期 Top 10 平均水平');
    expect(result.pace_type).toBe('高密度爽文型');
    expect(result.avg_tension).toBe(60);
    expect(result.peak_chapter).toBe('第186章');
    expect(result.structure_template).toBe('六幕结构');
    expect(result.structure_type).toBe('日常→种田→收服→远征→危机→决战');
    expect(result.analysis_mode).toBe('full');
    expect(result.data_completeness).toBe(0.95);
    expect(result.user_id).toBe('u-1');
    expect(result.status).toBe('completed');
  });

  it('returns only uploaded_books fields when analysis is null', () => {
    const result = flattenBookAnalysis(makeBook(), null);
    expect(result.title).toBe('测试小说');
    expect(result.total_chars).toBe(100000);
    expect(result.overall_score).toBeNull();
    expect(result.tags).toBeNull();
    expect(result.tone).toBeNull();
    expect(result.market_overall).toBeNull();
    expect(result.analysis_mode).toBeNull();
  });

  it('handles missing sub-sections (emotional_curve null, market_potential null)', () => {
    const analysis = makeAnalysis({
      emotional_curve: null as any,
      market_potential: null as any,
      theme_mining: null as any,
    });
    const result = flattenBookAnalysis(makeBook(), analysis);
    expect(result.overall_score).toBe(87);
    expect(result.avg_tension).toBeNull();
    expect(result.peak_chapter).toBeNull();
    expect(result.pace_type).toBeNull();
    expect(result.market_overall).toBeNull();
    expect(result.market_comparison).toBeNull();
    expect(result.tags).toBeNull();
    expect(result.tone).toBeNull();
  });

  it('never includes UI fields (roleColor, color, nodes x/y)', () => {
    const result = flattenBookAnalysis(makeBook(), makeAnalysis());
    const json = JSON.stringify(result);
    expect(json).not.toContain('roleColor');
    expect(json).not.toContain('bg-blue');
    expect(json).not.toContain('"x":');
    expect(json).not.toContain('"y":');
  });
});
