import { BadRequestException } from '@nestjs/common';
import type { OntologyView } from '@omaha/dsl';
import { DimensionConstraintEnforcer } from './dimension-constraint-enforcer';

/**
 * DimensionConstraintEnforcer black-box spec (ADR-0057). Exercises the narrow public `apply`
 * interface directly — the enforcer is the one place the "required dimensions must be constrained,
 * defaulted dimensions auto-inject" invariant lives, so its decision matrix is tested here against
 * the seam rather than through the whole QueryPlanner. The planner's own dimension specs remain as
 * an integration net.
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
    dimensions: { required: ['category', 'period'], defaults: { priceBand: '整体' } },
    ...over,
  } as OntologyView;
}

function makeEnforcer(availableValues: string[] = ['22.12', '26.04']) {
  const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue(availableValues.map((val) => ({ val }))) } as any;
  return { enforcer: new DimensionConstraintEnforcer(prisma), prisma };
}

describe('DimensionConstraintEnforcer (ADR-0057)', () => {
  it('throws DIMENSION_REQUIRED with field + scoped available values when a required dimension is missing', async () => {
    const { enforcer } = makeEnforcer(['22.12', '26.04']);
    const args = { tenantId: 't1', objectType: 'brand_share', filters: [{ field: 'category', operator: 'eq' as const, value: '电饭煲' }] };
    await expect(enforcer.apply(args, makeView())).rejects.toBeInstanceOf(BadRequestException);
    await enforcer.apply(args, makeView()).catch((err: any) => {
      const resp = err.getResponse();
      expect(resp.error.code).toBe('DIMENSION_REQUIRED');
      expect(resp.error.field).toBe('period');
      expect(resp.error.available).toEqual(['22.12', '26.04']);
    });
  });

  it('injects a defaulted dimension as an eq filter when unconstrained', async () => {
    const { enforcer } = makeEnforcer();
    const args = {
      tenantId: 't1', objectType: 'brand_share',
      filters: [
        { field: 'category', operator: 'eq' as const, value: '电饭煲' },
        { field: 'period', operator: 'eq' as const, value: '26.04' },
      ],
    };
    await enforcer.apply(args, makeView());
    expect(args.filters).toContainEqual({ field: 'priceBand', operator: 'eq', value: '整体' });
  });

  it('does NOT inject the default for a dimension that is being grouped (drill intent, ADR-0061)', async () => {
    // The dimension-default-blindspot: a groupBy[priceBand] WITHOUT an explicit priceBand filter
    // must NOT get priceBand=整体 auto-injected, or the group collapses to the single default row
    // and the Agent falsely concludes "no price-band data". Grouping a dim IS drilling it.
    const { enforcer } = makeEnforcer();
    const args = {
      tenantId: 't1', objectType: 'brand_share',
      filters: [
        { field: 'category', operator: 'eq' as const, value: '电饭煲' },
        { field: 'period', operator: 'eq' as const, value: '26.04' },
      ],
      groupBy: ['priceBand'],
    };
    await enforcer.apply(args, makeView());
    expect(args.filters.some((f) => f.field === 'priceBand')).toBe(false);
  });

  it('still injects the default for a NON-grouped defaulted dimension even when another dim is grouped', async () => {
    const { enforcer } = makeEnforcer();
    const args = {
      tenantId: 't1', objectType: 'brand_share',
      filters: [
        { field: 'category', operator: 'eq' as const, value: '电饭煲' },
        { field: 'period', operator: 'eq' as const, value: '26.04' },
      ],
      groupBy: ['brand'], // grouping brand, NOT priceBand → priceBand default still applies
    };
    await enforcer.apply(args, makeView());
    expect(args.filters).toContainEqual({ field: 'priceBand', operator: 'eq', value: '整体' });
  });

  it('does NOT inject the default when the dimension is already filtered', async () => {
    const { enforcer } = makeEnforcer();
    const args = {
      tenantId: 't1', objectType: 'brand_share',
      filters: [
        { field: 'category', operator: 'eq' as const, value: '电饭煲' },
        { field: 'period', operator: 'eq' as const, value: '26.04' },
        { field: 'priceBand', operator: 'eq' as const, value: '300-349' },
      ],
    };
    await enforcer.apply(args, makeView());
    expect(args.filters.filter((f) => f.field === 'priceBand')).toHaveLength(1);
    expect(args.filters).toContainEqual({ field: 'priceBand', operator: 'eq', value: '300-349' });
  });

  it('treats a required dimension as satisfied by any operator (in / gte), not just eq', async () => {
    const { enforcer } = makeEnforcer();
    const inArgs = {
      tenantId: 't1', objectType: 'brand_share',
      filters: [
        { field: 'category', operator: 'eq' as const, value: '电饭煲' },
        { field: 'period', operator: 'in' as const, value: ['24.12', '25.12'] },
      ],
    };
    await expect(enforcer.apply(inArgs, makeView())).resolves.toBeUndefined();
  });

  describe('requiredEquivalents (#178 — a coarser dim satisfies the required period)', () => {
    // market_metric requires `month`, but a `year` filter is a valid (coarser) temporal scope —
    // ADR-0059 derives year from month in lockstep. Without this, a groupBy[year] annual query is
    // rejected DIMENSION_REQUIRED:month, forcing the Agent into month-exhaustion (#178 root cause).
    function marketView(over: Partial<OntologyView> = {}): OntologyView {
      return makeView({
        objectType: 'market_metric',
        stringFields: new Set(['category', 'month', 'year', 'metric']),
        filterableFields: new Set(['category', 'month', 'year', 'metric', 'value']),
        dimensions: { required: ['category', 'month'], defaults: {}, requiredEquivalents: { month: ['year'] } },
        ...over,
      });
    }

    it('accepts a `year` filter in place of the required `month`', async () => {
      const { enforcer, prisma } = makeEnforcer();
      const args = {
        tenantId: 't1', objectType: 'market_metric',
        filters: [
          { field: 'category', operator: 'eq' as const, value: '电饭煲' },
          { field: 'year', operator: 'in' as const, value: ['24', '25'] },
        ],
      };
      await expect(enforcer.apply(args, marketView())).resolves.toBeUndefined();
      // No availability probe needed — the requirement was satisfied by the equivalent.
      expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('still rejects when neither month nor its equivalent year is present', async () => {
      const { enforcer } = makeEnforcer(['24', '25']);
      const args = {
        tenantId: 't1', objectType: 'market_metric',
        filters: [{ field: 'category', operator: 'eq' as const, value: '电饭煲' }],
      };
      await expect(enforcer.apply(args, marketView())).rejects.toBeInstanceOf(BadRequestException);
    });

    it('a plain `month` filter still satisfies the requirement (equivalents are additive)', async () => {
      const { enforcer } = makeEnforcer();
      const args = {
        tenantId: 't1', objectType: 'market_metric',
        filters: [
          { field: 'category', operator: 'eq' as const, value: '电饭煲' },
          { field: 'month', operator: 'eq' as const, value: '25.01' },
        ],
      };
      await expect(enforcer.apply(args, marketView())).resolves.toBeUndefined();
    });
  });

  it('is a no-op when the view declares no dimensions (non-AVC types)', async () => {
    const { enforcer, prisma } = makeEnforcer();
    const args = { tenantId: 't1', objectType: 'employee', filters: [] };
    await enforcer.apply(args, makeView({ dimensions: undefined }));
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(args.filters).toEqual([]);
  });
});
