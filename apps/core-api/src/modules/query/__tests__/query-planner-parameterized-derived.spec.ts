import { BadRequestException } from '@nestjs/common';
import type { OntologyView } from '@omaha/dsl';
import { QueryPlannerService } from '../query-planner.service';
import { DimensionConstraintEnforcer } from '../dimension-constraint-enforcer';

/**
 * ADR-0065 Slice B: Parameter Threading
 *
 * When an aggregate metric references a parameterized derived property
 * (expression contains $paramName), the planner:
 *  1. Accepts params?: Record<string, any> in buildMetricExprs
 *  2. Threads params into DSL compilation context
 *  3. Compiler handles $parameter nodes and replaces with $N placeholders
 *  4. Missing parameters throw clear errors
 *
 * Test coverage:
 *  - Parameterized derived field compiles to SQL with $N placeholders
 *  - Missing parameter throws descriptive error
 *  - Mixed base + parameterized derived fields work together
 */

function makeView(over: Partial<OntologyView> = {}): OntologyView {
  return {
    tenantId: 't1',
    objectType: 'market_metric',
    numericFields: new Set(['value', 'value_ly']),
    booleanFields: new Set(),
    stringFields: new Set(['brand', 'category']),
    filterableFields: new Set(['brand', 'category', 'value', 'value_ly']),
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

describe('QueryPlannerService — parameterized derived fields (ADR-0065 Slice B)', () => {
  beforeEach(() => {
    process.env.ENABLE_DERIVED_AGGREGATES = 'true';
  });

  afterEach(() => {
    delete process.env.ENABLE_DERIVED_AGGREGATES;
  });

  it('should handle parameterized derived fields', async () => {
    const view = makeView({
      derivedProperties: new Map([
        ['threshold_excess', { name: 'threshold_excess', expression: 'value - :threshold' }],
      ]),
    });
    const planner = makePlanner(view);

    const res = await planner.planAggregate({
      tenantId: 't1',
      objectType: 'market_metric',
      groupBy: ['brand'],
      metrics: [{ kind: 'sum', field: 'threshold_excess', alias: 'total_excess' }],
      allowedFields: null,
      params: { threshold: 1000 },
    });

    // Should compile to SUM((properties->>'value')::numeric - $1) AS "total_excess"
    // The $1 comes from the parameter being pushed to the params array
    expect(res.sql).toMatch(/SUM\(\(\(properties->>'value'\)::numeric\s*-\s*\$\d+\)\)\s+AS\s+"total_excess"/);

    // The params array should contain the threshold value
    expect(res.params).toContain(1000);
  });

  it('should throw on missing parameter', async () => {
    const view = makeView({
      derivedProperties: new Map([
        ['threshold_excess', { name: 'threshold_excess', expression: 'value - :threshold' }],
      ]),
    });
    const planner = makePlanner(view);

    await expect(
      planner.planAggregate({
        tenantId: 't1',
        objectType: 'market_metric',
        groupBy: ['brand'],
        metrics: [{ kind: 'sum', field: 'threshold_excess', alias: 'total_excess' }],
        allowedFields: null,
        // params not provided
      }),
    ).rejects.toThrow(/Missing parameter.*threshold/);
  });

  it('should mix base and parameterized derived fields', async () => {
    const view = makeView({
      derivedProperties: new Map([
        ['threshold_excess', { name: 'threshold_excess', expression: 'value - :threshold' }],
        ['yoy_growth', { name: 'yoy_growth', expression: '(value - value_ly) / value_ly' }],
      ]),
    });
    const planner = makePlanner(view);

    const res = await planner.planAggregate({
      tenantId: 't1',
      objectType: 'market_metric',
      groupBy: ['brand'],
      metrics: [
        { kind: 'sum', field: 'value', alias: 'total_value' },
        { kind: 'sum', field: 'threshold_excess', alias: 'total_excess' },
        { kind: 'sum', field: 'yoy_growth', alias: 'total_growth' },
      ],
      allowedFields: null,
      params: { threshold: 1000 },
    });

    // Base field should work (note: uses base.properties prefix from Slice D)
    expect(res.sql).toMatch(/SUM\(\(base\.properties->>'value'\)::numeric\)\s+AS\s+"total_value"/);

    // Parameterized derived field should work
    expect(res.sql).toMatch(/SUM\(\(\(properties->>'value'\)::numeric\s*-\s*\$\d+\)\)\s+AS\s+"total_excess"/);

    // Non-parameterized derived field should work
    expect(res.sql).toMatch(/SUM\(\(\(\(properties->>'value'\)::numeric\s*-\s*\(properties->>'value_ly'\)::numeric\)\s*\/\s*\(properties->>'value_ly'\)::numeric\)\)\s+AS\s+"total_growth"/);

    // Params array should contain the threshold
    expect(res.params).toContain(1000);
  });

  it('should handle multiple parameters', async () => {
    const view = makeView({
      derivedProperties: new Map([
        ['scaled_delta', { name: 'scaled_delta', expression: '(value - :baseline) * :multiplier' }],
      ]),
    });
    const planner = makePlanner(view);

    const res = await planner.planAggregate({
      tenantId: 't1',
      objectType: 'market_metric',
      groupBy: ['brand'],
      metrics: [{ kind: 'sum', field: 'scaled_delta', alias: 'total_scaled' }],
      allowedFields: null,
      params: { baseline: 500, multiplier: 1.5 },
    });

    // Should contain both parameter values
    expect(res.params).toContain(500);
    expect(res.params).toContain(1.5);

    // SQL should reference both parameters
    expect(res.sql).toMatch(/SUM\(\(\(\(properties->>'value'\)::numeric\s*-\s*\$\d+\)\s*\*\s*\$\d+\)\)\s+AS\s+"total_scaled"/);
  });
});
