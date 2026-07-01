import { BadRequestException } from '@nestjs/common';
import type { OntologyView } from '@omaha/dsl';
import { QueryPlannerService } from '../query-planner.service';
import { DimensionConstraintEnforcer } from '../dimension-constraint-enforcer';

/**
 * ADR-0061 §1: additivity enforcement on the aggregate path.
 * The planner injects AdditivityGuard before building metric SQL:
 *  - non-additive (share) + sum  → NON_ADDITIVE_SUM structured error
 *  - ratio (avgPrice w/ sibling cols) + avg → weighted SUM/SUM division
 *  - ratio without weight cols + avg → RATIO_AVG_UNWEIGHTABLE error
 *  - additive (value) + sum → ordinary SUM, untouched
 */
function makeView(over: Partial<OntologyView> = {}): OntologyView {
  return {
    tenantId: 't1',
    objectType: 'order_line',
    numericFields: new Set(['value', 'share', 'avgPrice', 'amount', 'qty']),
    booleanFields: new Set(),
    stringFields: new Set(['category', 'brand']),
    filterableFields: new Set(['category', 'brand', 'value', 'share', 'avgPrice', 'amount', 'qty']),
    sortableFields: new Set(['value']),
    relations: {},
    derivedProperties: new Map(),
    ...over,
  };
}

function makePlanner(view: OntologyView | null): QueryPlannerService {
  const viewLoader = {
    load: jest.fn().mockResolvedValue(view),
    resolveRelationByName: jest.fn().mockResolvedValue(null),
  } as any;
  const viewManager = {
    exists: jest.fn().mockResolvedValue(false),
    getViewName: jest.fn().mockReturnValue('mv_test'),
  } as any;
  const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([]) } as any;
  return new QueryPlannerService(viewLoader, viewManager, prisma, new DimensionConstraintEnforcer(prisma));
}

describe('QueryPlannerService — additivity guard (ADR-0061)', () => {
  it('rejects SUM of a non-additive field with NON_ADDITIVE_SUM', async () => {
    const planner = makePlanner(makeView({ additivity: new Map([['share', { kind: 'non-additive' }]]) }));
    await expect(
      planner.planAggregate({
        tenantId: 't1', objectType: 'order_line',
        groupBy: ['brand'],
        metrics: [{ kind: 'sum', field: 'share', alias: 'total_share' }],
        allowedFields: null,
      }),
    ).rejects.toMatchObject({
      response: { error: { code: 'NON_ADDITIVE_SUM', field: 'share' } },
    });
  });

  it('rewrites AVG of a ratio field to a weighted SUM/SUM division', async () => {
    const planner = makePlanner(
      makeView({ additivity: new Map([['avgPrice', { kind: 'ratio', ratioOf: { numerator: 'amount', denominator: 'qty' } }]]) }),
    );
    const res = await planner.planAggregate({
      tenantId: 't1', objectType: 'order_line',
      groupBy: ['brand'],
      metrics: [{ kind: 'avg', field: 'avgPrice', alias: 'wprice' }],
      allowedFields: null,
    });
    // weighted: SUM(amount)/NULLIF(SUM(qty),0)
    expect(res.sql).toMatch(/SUM\(\(base\.properties->>'amount'\)::numeric\)\s*\/\s*NULLIF\(SUM\(\(base\.properties->>'qty'\)::numeric\),\s*0\)\s+AS\s+"wprice"/);
    expect(res.sql).not.toMatch(/AVG\(\(base\.properties->>'avgPrice'\)/);
  });

  it('rejects AVG of a ratio field without weight columns (RATIO_AVG_UNWEIGHTABLE)', async () => {
    const planner = makePlanner(makeView({ additivity: new Map([['avgPrice', { kind: 'ratio' }]]) }));
    await expect(
      planner.planAggregate({
        tenantId: 't1', objectType: 'order_line',
        groupBy: ['brand'],
        metrics: [{ kind: 'avg', field: 'avgPrice', alias: 'p' }],
        allowedFields: null,
      }),
    ).rejects.toMatchObject({
      response: { error: { code: 'RATIO_AVG_UNWEIGHTABLE', field: 'avgPrice' } },
    });
  });

  it('leaves an additive field SUM untouched', async () => {
    const planner = makePlanner(makeView({ additivity: new Map([['value', { kind: 'additive' }]]) }));
    const res = await planner.planAggregate({
      tenantId: 't1', objectType: 'order_line',
      groupBy: ['brand'],
      metrics: [{ kind: 'sum', field: 'value', alias: 'total' }],
      allowedFields: null,
    });
    expect(res.sql).toMatch(/SUM\(\(base\.properties->>'value'\)::numeric\)\s+AS\s+"total"/);
  });

  it('passes when the view carries no additivity map (non-AVC types unaffected)', async () => {
    const planner = makePlanner(makeView());
    const res = await planner.planAggregate({
      tenantId: 't1', objectType: 'order_line',
      groupBy: ['brand'],
      metrics: [{ kind: 'sum', field: 'value', alias: 'total' }],
      allowedFields: null,
    });
    expect(res.sql).toMatch(/SUM\(\(base\.properties->>'value'\)::numeric\)\s+AS\s+"total"/);
  });
});
