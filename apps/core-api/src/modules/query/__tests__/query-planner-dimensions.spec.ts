import { BadRequestException } from '@nestjs/common';
import type { OntologyView } from '@omaha/dsl';
import { QueryPlannerService } from '../query-planner.service';
import { DimensionConstraintEnforcer } from '../dimension-constraint-enforcer';

/**
 * ADR-0057: Dimension constraint tests.
 * Verifies that required dimensions reject queries without the constraint,
 * and defaulted dimensions are auto-injected.
 */
function makeView(over: Partial<OntologyView> = {}): OntologyView {
  return {
    tenantId: 't1',
    objectType: 'brand_share',
    numericFields: new Set(['value']),
    booleanFields: new Set(),
    stringFields: new Set(['category', 'brand', 'priceBand', 'period', 'metric']),
    filterableFields: new Set(['category', 'brand', 'priceBand', 'period', 'metric', 'value']),
    sortableFields: new Set(['value']),
    relations: {},
    derivedProperties: new Map(),
    dimensions: {
      required: ['category', 'period'],
      defaults: { priceBand: '整体' },
    },
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
  const prisma = {
    $queryRawUnsafe: jest.fn().mockResolvedValue([
      { val: '22.12' }, { val: '23.12' }, { val: '24.12' }, { val: '25.12' }, { val: '26.04' },
    ]),
  } as any;
  return new QueryPlannerService(viewLoader, viewManager, prisma, new DimensionConstraintEnforcer(prisma));
}

describe('QueryPlannerService — dimension constraints (ADR-0057)', () => {
  describe('required dimensions', () => {
    it('throws DIMENSION_REQUIRED when category is missing', async () => {
      const planner = makePlanner(makeView());
      await expect(
        planner.plan({
          tenantId: 't1', objectType: 'brand_share', skip: 0, take: 20,
          filters: [{ field: 'period', operator: 'eq', value: '26.04' }],
          allowedFields: null,
        }),
      ).rejects.toMatchObject({
        response: { error: { code: 'DIMENSION_REQUIRED', field: 'category' } },
      });
    });

    it('throws DIMENSION_REQUIRED when period is missing', async () => {
      const planner = makePlanner(makeView());
      await expect(
        planner.plan({
          tenantId: 't1', objectType: 'brand_share', skip: 0, take: 20,
          filters: [{ field: 'category', operator: 'eq', value: '电饭煲' }],
          allowedFields: null,
        }),
      ).rejects.toMatchObject({
        response: { error: { code: 'DIMENSION_REQUIRED', field: 'period' } },
      });
    });

    it('includes scoped available values in the error', async () => {
      const planner = makePlanner(makeView());
      try {
        await planner.plan({
          tenantId: 't1', objectType: 'brand_share', skip: 0, take: 20,
          filters: [{ field: 'category', operator: 'eq', value: '电饭煲' }],
          allowedFields: null,
        });
        fail('should have thrown');
      } catch (err: any) {
        const resp = err.getResponse();
        expect(resp.error.available).toEqual(['22.12', '23.12', '24.12', '25.12', '26.04']);
        expect(resp.error.hint).toContain('period');
      }
    });

    it('passes when both required dimensions are present (eq)', async () => {
      const planner = makePlanner(makeView());
      const result = await planner.plan({
        tenantId: 't1', objectType: 'brand_share', skip: 0, take: 20,
        filters: [
          { field: 'category', operator: 'eq', value: '电饭煲' },
          { field: 'period', operator: 'eq', value: '26.04' },
        ],
        allowedFields: null,
      });
      expect(result.sql).toBeDefined();
    });

    it('passes when required dimension uses "in" operator (multi-period trend)', async () => {
      const planner = makePlanner(makeView());
      const result = await planner.plan({
        tenantId: 't1', objectType: 'brand_share', skip: 0, take: 20,
        filters: [
          { field: 'category', operator: 'eq', value: '电饭煲' },
          { field: 'period', operator: 'in', value: ['24.12', '25.12', '26.04'] },
        ],
        allowedFields: null,
      });
      expect(result.sql).toBeDefined();
    });

    it('passes when required dimension uses range operators (gte/lte)', async () => {
      const planner = makePlanner(makeView());
      const result = await planner.plan({
        tenantId: 't1', objectType: 'brand_share', skip: 0, take: 20,
        filters: [
          { field: 'category', operator: 'eq', value: '电饭煲' },
          { field: 'period', operator: 'gte', value: '24.12' },
        ],
        allowedFields: null,
      });
      expect(result.sql).toBeDefined();
    });
  });

  describe('defaulted dimensions', () => {
    it('auto-injects priceBand=整体 when not specified', async () => {
      const planner = makePlanner(makeView());
      const result = await planner.plan({
        tenantId: 't1', objectType: 'brand_share', skip: 0, take: 20,
        filters: [
          { field: 'category', operator: 'eq', value: '电饭煲' },
          { field: 'period', operator: 'eq', value: '26.04' },
        ],
        allowedFields: null,
      });
      // The injected default should appear in the compiled SQL
      expect(result.sql).toContain('priceBand');
    });

    it('does NOT inject default when priceBand is explicitly filtered', async () => {
      const planner = makePlanner(makeView());
      const result = await planner.plan({
        tenantId: 't1', objectType: 'brand_share', skip: 0, take: 20,
        filters: [
          { field: 'category', operator: 'eq', value: '电饭煲' },
          { field: 'period', operator: 'eq', value: '26.04' },
          { field: 'priceBand', operator: 'eq', value: '300-349' },
        ],
        allowedFields: null,
      });
      // Should still compile fine (no double-injection)
      expect(result.sql).toBeDefined();
      expect(result.params.filter(p => p === '整体')).toHaveLength(0);
    });
  });

  describe('no dimensions (non-AVC types)', () => {
    it('passes without any dimension constraints when dimensions is undefined', async () => {
      const view = makeView({ dimensions: undefined });
      const planner = makePlanner(view);
      const result = await planner.plan({
        tenantId: 't1', objectType: 'brand_share', skip: 0, take: 20,
        filters: [],
        allowedFields: null,
      });
      expect(result.sql).toBeDefined();
    });
  });

  describe('aggregate path', () => {
    it('throws DIMENSION_REQUIRED on aggregate_objects missing period', async () => {
      const planner = makePlanner(makeView());
      await expect(
        planner.planAggregate({
          tenantId: 't1', objectType: 'brand_share',
          filters: [{ field: 'category', operator: 'eq', value: '电饭煲' }],
          groupBy: ['brand'],
          metrics: [{ kind: 'sum', field: 'value', alias: 'total' }],
          allowedFields: null,
        }),
      ).rejects.toMatchObject({
        response: { error: { code: 'DIMENSION_REQUIRED', field: 'period' } },
      });
    });

    it('auto-injects priceBand default on aggregate path', async () => {
      const planner = makePlanner(makeView());
      const result = await planner.planAggregate({
        tenantId: 't1', objectType: 'brand_share',
        filters: [
          { field: 'category', operator: 'eq', value: '电饭煲' },
          { field: 'period', operator: 'eq', value: '26.04' },
        ],
        groupBy: ['brand'],
        metrics: [{ kind: 'sum', field: 'value', alias: 'total' }],
        allowedFields: null,
      });
      expect(result.sql).toContain('priceBand');
    });
  });
});
