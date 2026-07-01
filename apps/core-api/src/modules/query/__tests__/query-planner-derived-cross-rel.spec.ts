import { BadRequestException } from '@nestjs/common';
import type { OntologyView } from '@omaha/dsl';
import { QueryPlannerService } from '../query-planner.service';
import { DimensionConstraintEnforcer } from '../dimension-constraint-enforcer';

/**
 * ADR-0065 Slice D: Cross-Relation Path Reuse
 *
 * When an aggregate metric references a derived property that contains a
 * cross-relation path (e.g., "model_metric.brand" in brand-level aggregation),
 * the planner must:
 *  1. Parse and detect cross-relation paths within derived expressions
 *  2. Compile them using compileRelationPath() method
 *  3. Generate unique aliases (aliasCounter) to avoid collisions
 *  4. Reuse JOIN registration logic from ScopedWhere
 */

function makeView(over: Partial<OntologyView> = {}): OntologyView {
  return {
    tenantId: 't1',
    objectType: 'brand_metric',
    numericFields: new Set(['sales', 'units']),
    booleanFields: new Set(),
    stringFields: new Set(['brand']),
    filterableFields: new Set(['brand', 'sales', 'units']),
    sortableFields: new Set(['sales']),
    relations: {
      model: {
        otherType: 'model_metric',
        fkSide: 'other',
        storageKey: 'model_id',
      },
    },
    derivedProperties: new Map(),
    ...over,
  };
}

function makeModelView(over: Partial<OntologyView> = {}): OntologyView {
  return {
    tenantId: 't1',
    objectType: 'model_metric',
    numericFields: new Set(['price', 'rating']),
    booleanFields: new Set(),
    stringFields: new Set(['model_name', 'brand']),
    filterableFields: new Set(['model_name', 'brand', 'price', 'rating']),
    sortableFields: new Set(['price']),
    relations: {},
    derivedProperties: new Map(),
    ...over,
  };
}

function makePlanner(
  view: OntologyView | null,
  modelView?: OntologyView | null,
): QueryPlannerService {
  const viewLoader = {
    load: jest.fn().mockImplementation(async (tenantId: string, objectType: string) => {
      if (objectType === 'brand_metric') return view;
      if (objectType === 'model_metric') return modelView ?? null;
      return null;
    }),
    resolveRelationByName: jest.fn().mockImplementation(async (tenantId: string, objectType: string, relationName: string) => {
      if (objectType === 'brand_metric' && relationName === 'model') {
        return {
          otherType: 'model_metric',
          fkSide: 'other',
          storageKey: 'brand_id',
        };
      }
      return null;
    }),
  } as any;
  const viewManager = {
    exists: jest.fn().mockResolvedValue(false),
    getViewName: jest.fn().mockReturnValue('mv_test'),
  } as any;
  const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([]) } as any;
  return new QueryPlannerService(viewLoader, viewManager, prisma, new DimensionConstraintEnforcer(prisma));
}

describe('QueryPlannerService — derived cross-rel (ADR-0065 Slice D)', () => {
  beforeEach(() => {
    process.env.ENABLE_DERIVED_AGGREGATES = 'true';
  });

  afterEach(() => {
    delete process.env.ENABLE_DERIVED_AGGREGATES;
  });

  it('should handle cross-rel derived fields', async () => {
    const modelView = makeModelView();
    const view = makeView({
      derivedProperties: new Map([
        ['avg_model_price', { name: 'avg_model_price', expression: 'model.price' }],
      ]),
    });
    const planner = makePlanner(view, modelView);

    const res = await planner.planAggregate({
      tenantId: 't1',
      objectType: 'brand_metric',
      groupBy: ['brand'],
      metrics: [{ kind: 'avg', field: 'avg_model_price', alias: 'avg_price' }],
      allowedFields: null,
    });

    // Should contain a LEFT JOIN to model_metric with unique alias
    expect(res.sql).toMatch(/LEFT JOIN\s+object_instances\s+rel_\d+/i);
    // Should reference the joined table's price field using the alias
    expect(res.sql).toMatch(/rel_\d+\.properties->>'price'/);
    // Should have AVG aggregate
    expect(res.sql).toMatch(/AVG\(/i);
    // Base table should be aliased as 'base'
    expect(res.sql).toMatch(/FROM object_instances base/i);
  });

  it('should avoid alias collision in nested subqueries', async () => {
    const modelView = makeModelView();
    const view = makeView({
      derivedProperties: new Map([
        ['model_price_ratio', { name: 'model_price_ratio', expression: 'model.price / sales' }],
      ]),
    });
    const planner = makePlanner(view, modelView);

    const res = await planner.planAggregate({
      tenantId: 't1',
      objectType: 'brand_metric',
      groupBy: ['brand'],
      metrics: [
        { kind: 'sum', field: 'sales', alias: 'total_sales' },
        { kind: 'avg', field: 'model_price_ratio', alias: 'avg_ratio' },
      ],
      allowedFields: null,
    });

    // Should generate unique aliases for each relation join
    // Extract all LEFT JOIN table aliases
    const joinMatches = res.sql.matchAll(/LEFT JOIN\s+object_instances\s+(rel_\d+)/gi);
    const aliases = Array.from(joinMatches, m => m[1]);

    // All aliases should be unique
    const uniqueAliases = new Set(aliases);
    expect(aliases.length).toBe(uniqueAliases.size);

    // Should have at least one join for the cross-rel path
    expect(aliases.length).toBeGreaterThanOrEqual(1);

    // Each alias should follow the pattern rel_N
    for (const alias of aliases) {
      expect(alias).toMatch(/^rel_\d+$/);
    }
  });

  it('should handle multiple cross-rel paths in same expression', async () => {
    const modelView = makeModelView();
    const view = makeView({
      derivedProperties: new Map([
        ['price_per_unit', { name: 'price_per_unit', expression: 'model.price / units' }],
      ]),
    });
    const planner = makePlanner(view, modelView);

    const res = await planner.planAggregate({
      tenantId: 't1',
      objectType: 'brand_metric',
      groupBy: ['brand'],
      metrics: [{ kind: 'avg', field: 'price_per_unit', alias: 'avg_price_per_unit' }],
      allowedFields: null,
    });

    // Should compile both the cross-rel path (model.price) and local field (units)
    expect(res.sql).toMatch(/LEFT JOIN\s+object_instances/i);
    expect(res.sql).toMatch(/rel_\d+\.properties->>'price'/);
    expect(res.sql).toMatch(/base\.properties->>'units'/);
  });

  it('should error on unknown relation in derived field', async () => {
    const view = makeView({
      derivedProperties: new Map([
        ['bad_field', { name: 'bad_field', expression: 'unknown_relation.price' }],
      ]),
    });
    const planner = makePlanner(view, null);

    await expect(
      planner.planAggregate({
        tenantId: 't1',
        objectType: 'brand_metric',
        groupBy: ['brand'],
        metrics: [{ kind: 'avg', field: 'bad_field', alias: 'bad' }],
        allowedFields: null,
      }),
    ).rejects.toThrow();
  });
});
