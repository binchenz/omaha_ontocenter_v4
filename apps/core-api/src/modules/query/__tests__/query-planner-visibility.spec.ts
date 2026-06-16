import { BadRequestException } from '@nestjs/common';
import type { OntologyView } from '@omaha/dsl';
import { QueryPlannerService } from '../query-planner.service';
import { DimensionConstraintEnforcer } from '../dimension-constraint-enforcer';

/**
 * Field-visibility enforcement at the input seam. These assert that a masked
 * field is rejected at plan time exactly like a non-capable / absent field —
 * the leak that ADR-0036 closes. The planner is driven with stubbed view
 * loader / view manager so no DB is needed.
 */
function makeView(over: Partial<OntologyView> = {}): OntologyView {
  return {
    tenantId: 't1',
    objectType: 'Employee',
    numericFields: new Set(['age', 'salary']),
    booleanFields: new Set(['active']),
    stringFields: new Set(['name', 'salaryBand']),
    filterableFields: new Set(['age', 'salary', 'name', 'salaryBand']),
    sortableFields: new Set(['age', 'salary']),
    relations: {},
    derivedProperties: new Map(),
    ...over,
  };
}

function makePlanner(view: OntologyView | null, viewExists = false): QueryPlannerService {
  const viewLoader = {
    load: jest.fn().mockResolvedValue(view),
    resolveRelationByName: jest.fn().mockResolvedValue(null),
  } as any;
  const viewManager = {
    exists: jest.fn().mockResolvedValue(viewExists),
    getViewName: jest.fn().mockReturnValue('mv_employee'),
  } as any;
  const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([]) } as any;
  return new QueryPlannerService(viewLoader, viewManager, prisma, new DimensionConstraintEnforcer(prisma));
}

const VISIBLE = new Set(['age', 'name']); // salary + salaryBand masked

describe('QueryPlannerService — field visibility (input seam)', () => {
  describe('filter', () => {
    it('rejects a filter on a masked field like a non-filterable one', async () => {
      const planner = makePlanner(makeView());
      await expect(
        planner.plan({
          tenantId: 't1', objectType: 'Employee', skip: 0, take: 20,
          filters: [{ field: 'salary', operator: 'gt', value: 1000 }],
          allowedFields: VISIBLE,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows a filter on a visible field', async () => {
      const planner = makePlanner(makeView());
      const planned = await planner.plan({
        tenantId: 't1', objectType: 'Employee', skip: 0, take: 20,
        filters: [{ field: 'age', operator: 'gt', value: 30 }],
        allowedFields: VISIBLE,
      });
      expect(planned.sql).toContain('age');
    });

    it('allows everything when allowedFields is null (⊤)', async () => {
      const planner = makePlanner(makeView());
      const planned = await planner.plan({
        tenantId: 't1', objectType: 'Employee', skip: 0, take: 20,
        filters: [{ field: 'salary', operator: 'gt', value: 1000 }],
        allowedFields: null,
      });
      expect(planned.sql).toContain('salary');
    });
  });

  describe('groupBy', () => {
    it('rejects groupBy on a masked field', async () => {
      const planner = makePlanner(makeView());
      await expect(
        planner.planAggregate({
          tenantId: 't1', objectType: 'Employee',
          groupBy: ['salaryBand'], metrics: [{ kind: 'count', alias: 'n' }],
          allowedFields: VISIBLE,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('numeric metric', () => {
    it('rejects sum over a masked numeric field', async () => {
      const planner = makePlanner(makeView());
      await expect(
        planner.planAggregate({
          tenantId: 't1', objectType: 'Employee',
          metrics: [{ kind: 'sum', field: 'salary', alias: 's' }],
          allowedFields: VISIBLE,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects countDistinct over a masked field (cardinality leak)', async () => {
      const planner = makePlanner(makeView());
      await expect(
        planner.planAggregate({
          tenantId: 't1', objectType: 'Employee',
          metrics: [{ kind: 'countDistinct', field: 'salaryBand', alias: 'd' }],
          allowedFields: VISIBLE,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows countDistinct over a visible field', async () => {
      const planner = makePlanner(makeView());
      const planned = await planner.planAggregate({
        tenantId: 't1', objectType: 'Employee',
        metrics: [{ kind: 'countDistinct', field: 'name', alias: 'd' }],
        allowedFields: VISIBLE,
      });
      expect(planned.sql).toContain('count(DISTINCT');
    });
  });

  describe('leniency-hole regression', () => {
    // An uncurated type (no filterable fields) normally allows filtering on
    // anything. A restricted principal whose visible fields are disjoint from
    // the (empty) filterable set must NOT inherit that leniency.
    it('still rejects a masked filter when the narrowed filterable set is empty', async () => {
      const uncurated = makeView({ filterableFields: new Set() });
      const planner = makePlanner(uncurated);
      await expect(
        planner.plan({
          tenantId: 't1', objectType: 'Employee', skip: 0, take: 20,
          filters: [{ field: 'salary', operator: 'gt', value: 1000 }],
          allowedFields: new Set(['name']),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('preserves leniency for ⊤ on an uncurated type', async () => {
      const uncurated = makeView({ filterableFields: new Set() });
      const planner = makePlanner(uncurated);
      const planned = await planner.plan({
        tenantId: 't1', objectType: 'Employee', skip: 0, take: 20,
        filters: [{ field: 'salary', operator: 'gt', value: 1000 }],
        allowedFields: null,
      });
      expect(planned.sql).toContain('salary');
    });
  });
});
