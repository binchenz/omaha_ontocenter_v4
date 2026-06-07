import { PlanSummarizer } from '../plan-summarizer.service';
import { OntologySchema } from '../../ontology/ontology.sdk';

const SCHEMA: OntologySchema = {
  types: [
    {
      name: 'episode', label: '剧集片段', description: '',
      properties: [
        { name: 'series', type: 'string', label: '剧集', filterable: true },
        { name: 'shotCount', type: 'number', label: '镜头数', filterable: true, sortable: true },
      ],
      derivedProperties: [],
      actions: [],
    },
    {
      name: 'shot', label: '镜头', description: '',
      properties: [
        { name: 'duration', type: 'number', label: '时长', filterable: true, sortable: true, unit: 's' },
        { name: 'shotSize', type: 'string', label: '景别', filterable: true },
      ],
      derivedProperties: [],
      actions: [],
    },
  ],
  relationships: [
    { name: 'episode_shots', sourceType: 'episode', targetType: 'shot', cardinality: 'one-to-many' },
  ],
};

function makeSummarizer(): PlanSummarizer {
  const sdk = { getSchema: jest.fn().mockResolvedValue(SCHEMA) } as any;
  return new PlanSummarizer(sdk);
}

describe('PlanSummarizer', () => {
  let s: PlanSummarizer;
  beforeEach(() => { s = makeSummarizer(); });

  it('returns null for non-data tools', async () => {
    expect(await s.summarize('t', 'create_object_type', {})).toBeNull();
  });

  it('summarizes a simple count aggregate with type label', async () => {
    const out = await s.summarize('t', 'aggregate_objects', {
      objectType: 'shot', metrics: [{ kind: 'count', alias: 'n' }],
    });
    expect(out).toBe('查询了「镜头」，统计 数量');
  });

  it('summarizes a numeric-threshold filter with operator + field label', async () => {
    const out = await s.summarize('t', 'aggregate_objects', {
      objectType: 'shot',
      filters: [{ field: 'duration', operator: 'gt', value: 5 }],
      metrics: [{ kind: 'count', alias: 'n' }],
    });
    expect(out).toBe('查询了「镜头」，筛选 时长 大于 5，统计 数量');
  });

  it('summarizes a cross-rel dot-path groupBy, resolving the related type', async () => {
    const out = await s.summarize('t', 'aggregate_objects', {
      objectType: 'shot',
      groupBy: ['episode_shots.series'],
      metrics: [{ kind: 'avg', field: 'duration', alias: 'a' }],
    });
    expect(out).toBe('查询了「镜头」，按 剧集片段的剧集 分组，统计 时长的平均值（s）');
  });

  it('summarizes a query_objects with sort', async () => {
    const out = await s.summarize('t', 'query_objects', {
      objectType: 'shot', sort: { field: 'duration', direction: 'desc' },
    });
    expect(out).toBe('查询了「镜头」，按 时长 降序');
  });

  it('falls back to raw names for unknown type/field, never throws', async () => {
    const out = await s.summarize('t', 'aggregate_objects', {
      objectType: 'mystery', groupBy: ['ghost'], metrics: [{ kind: 'sum', field: 'phantom', alias: 'x' }],
    });
    expect(out).toContain('mystery');
    expect(out).toContain('ghost');
  });

  it('returns null (not throw) when schema load fails', async () => {
    const sdk = { getSchema: jest.fn().mockRejectedValue(new Error('boom')) } as any;
    const broken = new PlanSummarizer(sdk);
    expect(await broken.summarize('t', 'aggregate_objects', { objectType: 'shot' })).toBeNull();
  });
});
