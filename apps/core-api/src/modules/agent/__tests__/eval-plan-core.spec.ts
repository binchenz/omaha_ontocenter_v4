import {
  extractPlanCore,
  comparePlanCore,
  scorePlan,
  normalizeOperator,
} from '@omaha/shared-types';

describe('extractPlanCore', () => {
  it('extracts the semantic core of an aggregate plan', () => {
    const core = extractPlanCore('aggregate_objects', {
      objectType: 'shot',
      filters: [{ field: 'duration', operator: 'gt', value: 5 }],
      groupBy: ['episode_shots.series'],
      metrics: [{ kind: 'avg', field: 'duration', alias: 'avg_d' }],
      orderBy: [{ kind: 'metric', by: 'avg_d', direction: 'desc' }],
      maxGroups: 100,
    });
    expect(core).toEqual({
      tool: 'aggregate_objects',
      objectType: 'shot',
      metrics: ['avg:duration'],
      filters: ['duration:>'],
      groupBy: ['episode_shots.series'],
      sort: null,
    });
  });

  it('represents count metric without a field', () => {
    const core = extractPlanCore('aggregate_objects', { objectType: 'shot', metrics: [{ kind: 'count', alias: 'n' }] });
    expect(core.metrics).toEqual(['count']);
  });

  it('captures sort on a plain query', () => {
    const core = extractPlanCore('query_objects', { objectType: 'shot', sort: { field: 'duration', direction: 'desc' } });
    expect(core.sort).toBe('duration:desc');
  });
});

describe('comparePlanCore — semantic-core differences score as MISMATCH', () => {
  const base = extractPlanCore('aggregate_objects', {
    objectType: 'shot',
    metrics: [{ kind: 'avg', field: 'duration' }],
    groupBy: ['series'],
  });

  it('wrong metric (avg vs sum) is a mismatch', () => {
    const actual = extractPlanCore('aggregate_objects', { objectType: 'shot', metrics: [{ kind: 'sum', field: 'duration' }], groupBy: ['series'] });
    const cmp = comparePlanCore(base, actual);
    expect(cmp.match).toBe(false);
    expect(cmp.diffs.join()).toContain('指标');
  });

  it('wrong groupBy is a mismatch', () => {
    const actual = extractPlanCore('aggregate_objects', { objectType: 'shot', metrics: [{ kind: 'avg', field: 'duration' }], groupBy: ['mood'] });
    expect(comparePlanCore(base, actual).match).toBe(false);
  });

  it('wrong aggregated field is a mismatch', () => {
    const actual = extractPlanCore('aggregate_objects', { objectType: 'shot', metrics: [{ kind: 'avg', field: 'startTime' }], groupBy: ['series'] });
    expect(comparePlanCore(base, actual).match).toBe(false);
  });

  it('wrong objectType is a mismatch', () => {
    const actual = extractPlanCore('aggregate_objects', { objectType: 'episode', metrics: [{ kind: 'avg', field: 'duration' }], groupBy: ['series'] });
    expect(comparePlanCore(base, actual).match).toBe(false);
  });

  it('opposite filter direction (gt vs lt) is a mismatch', () => {
    const e = extractPlanCore('query_objects', { objectType: 'shot', filters: [{ field: 'duration', operator: 'gt', value: 5 }] });
    const a = extractPlanCore('query_objects', { objectType: 'shot', filters: [{ field: 'duration', operator: 'lt', value: 5 }] });
    expect(comparePlanCore(e, a).match).toBe(false);
  });

  it('a missing filtered field is a mismatch', () => {
    const e = extractPlanCore('query_objects', { objectType: 'shot', filters: [{ field: 'duration', operator: 'gt', value: 5 }] });
    const a = extractPlanCore('query_objects', { objectType: 'shot', filters: [] });
    expect(comparePlanCore(e, a).match).toBe(false);
  });
});

describe('comparePlanCore — execution-detail noise scores as MATCH', () => {
  it('different limit / maxGroups / pageSize does not affect the score', () => {
    const e = extractPlanCore('aggregate_objects', { objectType: 'shot', metrics: [{ kind: 'count' }], maxGroups: 100 });
    const a = extractPlanCore('aggregate_objects', { objectType: 'shot', metrics: [{ kind: 'count' }], maxGroups: 500, pageToken: 'x' });
    expect(comparePlanCore(e, a).match).toBe(true);
  });

  it('different default orderBy on an AGGREGATE is ignored', () => {
    const e = extractPlanCore('aggregate_objects', { objectType: 'shot', metrics: [{ kind: 'count' }], orderBy: [{ kind: 'metric', by: 'n', direction: 'asc' }] });
    const a = extractPlanCore('aggregate_objects', { objectType: 'shot', metrics: [{ kind: 'count' }], orderBy: [{ kind: 'metric', by: 'n', direction: 'desc' }] });
    expect(comparePlanCore(e, a).match).toBe(true);
  });

  it('select column order / extra select fields are ignored (not part of the core)', () => {
    const e = extractPlanCore('query_objects', { objectType: 'shot', select: ['a', 'b'] });
    const a = extractPlanCore('query_objects', { objectType: 'shot', select: ['b', 'a', 'c'] });
    expect(comparePlanCore(e, a).match).toBe(true);
  });

  it('gt vs gte collapse to the same direction (the ADR-0029 boundary-semantics artifact)', () => {
    const e = extractPlanCore('query_objects', { objectType: 'shot', filters: [{ field: 'duration', operator: 'gt', value: 5 }] });
    const a = extractPlanCore('query_objects', { objectType: 'shot', filters: [{ field: 'duration', operator: 'gte', value: 5 }] });
    expect(comparePlanCore(e, a).match).toBe(true);
  });

  it('filter VALUE differences are ignored (only field + direction are semantic)', () => {
    const e = extractPlanCore('query_objects', { objectType: 'shot', filters: [{ field: 'duration', operator: 'gt', value: 5 }] });
    const a = extractPlanCore('query_objects', { objectType: 'shot', filters: [{ field: 'duration', operator: 'gt', value: 999 }] });
    expect(comparePlanCore(e, a).match).toBe(true);
  });

  it('metric/groupBy ordering does not matter (order-independent)', () => {
    const e = extractPlanCore('aggregate_objects', { objectType: 'shot', metrics: [{ kind: 'sum', field: 'x' }, { kind: 'avg', field: 'y' }], groupBy: ['a', 'b'] });
    const a = extractPlanCore('aggregate_objects', { objectType: 'shot', metrics: [{ kind: 'avg', field: 'y' }, { kind: 'sum', field: 'x' }], groupBy: ['b', 'a'] });
    expect(comparePlanCore(e, a).match).toBe(true);
  });
});

describe('normalizeOperator / scorePlan', () => {
  it('normalizes operators to direction buckets', () => {
    expect(normalizeOperator('gt')).toBe('>');
    expect(normalizeOperator('gte')).toBe('>');
    expect(normalizeOperator('lt')).toBe('<');
    expect(normalizeOperator('lte')).toBe('<');
    expect(normalizeOperator('eq')).toBe('=');
  });

  it('scorePlan composes extract + compare', () => {
    const r = scorePlan(
      { tool: 'aggregate_objects', args: { objectType: 'shot', metrics: [{ kind: 'count' }] } },
      { tool: 'aggregate_objects', args: { objectType: 'shot', metrics: [{ kind: 'count' }], maxGroups: 7 } },
    );
    expect(r.match).toBe(true);
  });
});
