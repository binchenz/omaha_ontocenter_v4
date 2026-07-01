import { BadRequestException } from '@nestjs/common';
import type { OntologyView } from '@omaha/dsl';
import { QueryPlannerService } from '../query-planner.service';
import { DimensionConstraintEnforcer } from '../dimension-constraint-enforcer';

/**
 * ADR-0065 Slice A: Detection + Compilation in QueryPlanner.
 *
 * When an aggregate metric references a derived property (field in
 * view.derivedProperties), the planner:
 *  1. Detects it's derived (not in numericFields)
 *  2. Looks up the definition in view.derivedProperties
 *  3. Compiles the DSL expression to SQL via buildCompileContext + compile
 *  4. Returns a MetricExpression with isDerived flag
 *
 * Fallback: ENABLE_DERIVED_AGGREGATES=false → legacy path (treat as missing field).
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

describe('QueryPlannerService — derived aggregates (ADR-0065 Slice A)', () => {
  describe('with ENABLE_DERIVED_AGGREGATES=true', () => {
    beforeEach(() => {
      process.env.ENABLE_DERIVED_AGGREGATES = 'true';
    });

    afterEach(() => {
      delete process.env.ENABLE_DERIVED_AGGREGATES;
    });

    it('should expand yoy_growth to SQL', async () => {
      const view = makeView({
        derivedProperties: new Map([
          ['yoy_growth', { name: 'yoy_growth', expression: '(value - value_ly) / value_ly' }],
        ]),
      });
      const planner = makePlanner(view);

      const res = await planner.planAggregate({
        tenantId: 't1',
        objectType: 'market_metric',
        groupBy: ['brand'],
        metrics: [{ kind: 'sum', field: 'yoy_growth', alias: 'total_growth' }],
        allowedFields: null,
      });

      // Should compile the derived expression inline: ((value - value_ly) / value_ly)
      // Wrapped in SUM and with ::numeric casts on the base fields
      expect(res.sql).toMatch(/SUM\(\(\(\(properties->>'value'\)::numeric\s*-\s*\(properties->>'value_ly'\)::numeric\)\s*\/\s*\(properties->>'value_ly'\)::numeric\)\)\s+AS\s+"total_growth"/);
    });

    it('should mix base and derived properties', async () => {
      const view = makeView({
        derivedProperties: new Map([
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
          { kind: 'sum', field: 'yoy_growth', alias: 'total_growth' },
        ],
        allowedFields: null,
      });

      // Base field: regular SUM((base.properties->>'value')::numeric)
      expect(res.sql).toMatch(/SUM\(\(base\.properties->>'value'\)::numeric\)\s+AS\s+"total_value"/);
      // Derived field: SUM((compiled expression))
      expect(res.sql).toMatch(/SUM\(\(\(\(properties->>'value'\)::numeric\s*-\s*\(properties->>'value_ly'\)::numeric\)\s*\/\s*\(properties->>'value_ly'\)::numeric\)\)\s+AS\s+"total_growth"/);
    });

    it('should handle derived field not found error', async () => {
      const view = makeView({
        derivedProperties: new Map(),
      });
      const planner = makePlanner(view);

      await expect(
        planner.planAggregate({
          tenantId: 't1',
          objectType: 'market_metric',
          groupBy: ['brand'],
          metrics: [{ kind: 'sum', field: 'yoy_growth', alias: 'total_growth' }],
          allowedFields: null,
        }),
      ).rejects.toMatchObject({
        response: {
          error: {
            code: 'DERIVED_PROPERTY_NOT_FOUND',
            field: 'yoy_growth',
            hint: expect.stringContaining('yoy_growth'),
          },
        },
      });
    });
  });

  describe('with ENABLE_DERIVED_AGGREGATES=false (legacy fallback)', () => {
    beforeEach(() => {
      process.env.ENABLE_DERIVED_AGGREGATES = 'false';
    });

    afterEach(() => {
      delete process.env.ENABLE_DERIVED_AGGREGATES;
    });

    it('should treat derived field as missing and reject with METRIC_INVALID_FIELD_TYPE', async () => {
      const view = makeView({
        derivedProperties: new Map([
          ['yoy_growth', { name: 'yoy_growth', expression: '(value - value_ly) / value_ly' }],
        ]),
      });
      const planner = makePlanner(view);

      await expect(
        planner.planAggregate({
          tenantId: 't1',
          objectType: 'market_metric',
          groupBy: ['brand'],
          metrics: [{ kind: 'sum', field: 'yoy_growth', alias: 'total_growth' }],
          allowedFields: null,
        }),
      ).rejects.toMatchObject({
        response: {
          error: {
            code: 'METRIC_INVALID_FIELD_TYPE',
            field: 'yoy_growth',
          },
        },
      });
    });
  });
});
