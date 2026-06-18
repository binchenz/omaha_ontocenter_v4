import { BadRequestException } from '@nestjs/common';
import { MetricQueryService } from './metric-query.service';
import type { AggregationResponse } from './query.service';

/**
 * ADR-0064 §4: MetricQueryService is the resolve→bind→execute path behind the
 * query_metric tool. These tests prove the tracer metric (零售额) resolves
 * end-to-end and the request handed to the ADR-0017 aggregate primitive targets
 * the correct star with the metric pinned — asserting observable selection/binding,
 * not internal classifier labels. QueryService is mocked (the engine + slice-①
 * envelope are covered by their own specs).
 */
function makeService(aggResponse: AggregationResponse) {
  const aggregateObjects = jest.fn().mockResolvedValue(aggResponse);
  const queryService = { aggregateObjects } as any;
  return { svc: new MetricQueryService(queryService), aggregateObjects };
}

const user = { id: 'u1', tenantId: 't1', email: 'a@b.c', roleId: 'r1', permissions: [] } as any;

// A representative aggregate response already carrying the slice-① envelope.
const ENVELOPED: AggregationResponse = {
  groups: [
    {
      key: {},
      metrics: { 零售额: 39012.84 },
      measures: {
        零售额: { display: '3.90 亿元（39,012.84 万元）', raw: 39012.84, unit: '万元', metric: '零售额', additivity: 'additive', universe: 'whole-market' },
      },
    },
  ],
  truncated: false,
  nextPageToken: null,
  totalGroupsEstimate: 1,
};

describe('MetricQueryService.query (ADR-0064 §4)', () => {
  it('resolves the 零售额 tracer and binds to market_metric with the metric pinned', async () => {
    const { svc, aggregateObjects } = makeService(ENVELOPED);
    const out = await svc.query(user, { metric: '零售额', dimensions: { category: '电饭煲' }, time: { month: '26.04' }, intent: 'lookup' });

    expect(out.metric).toBe('零售额');
    expect(out.star).toBe('market_metric');

    // The request handed to the aggregate primitive targets the right star + pins the metric.
    const req = aggregateObjects.mock.calls[0][1];
    expect(req.objectType).toBe('market_metric');
    expect(req.filters).toContainEqual({ field: 'metric', operator: 'eq', value: '零售额' });
    expect(req.metrics).toEqual([{ kind: 'sum', field: 'value', alias: '零售额' }]);
  });

  it('resolves a synonym (GMV) to the same tracer metric', async () => {
    const { svc } = makeService(ENVELOPED);
    const out = await svc.query(user, { metric: 'GMV', dimensions: { category: '电饭煲' }, time: { month: '26.04' } });
    expect(out.metric).toBe('零售额');
    expect(out.matchedOn).toBe('GMV');
  });

  it('returns an answer carrying the slice-① MeasureCell envelope with the correct caliber', async () => {
    const { svc } = makeService(ENVELOPED);
    const out = await svc.query(user, { metric: '零售额', dimensions: { category: '电饭煲' }, time: { month: '26.04' } });
    const cell = out.result.groups[0].measures!.零售额;
    expect(cell.display).toBe('3.90 亿元（39,012.84 万元）');
    expect(cell.unit).toBe('万元');
    expect(cell.additivity).toBe('additive');
    expect(cell.universe).toBe('whole-market');
  });

  it('throws a structured METRIC_NOT_IN_CATALOGUE error for an off-catalogue metric', async () => {
    const { svc, aggregateObjects } = makeService(ENVELOPED);
    await expect(svc.query(user, { metric: '利润率' })).rejects.toBeInstanceOf(BadRequestException);
    await svc.query(user, { metric: '利润率' }).catch((err: any) => {
      const resp = err.getResponse();
      expect(resp.error.code).toBe('METRIC_NOT_IN_CATALOGUE');
      expect(resp.error.available).toContain('零售额');
    });
    expect(aggregateObjects).not.toHaveBeenCalled(); // never hits the engine for an unknown metric
  });
});
