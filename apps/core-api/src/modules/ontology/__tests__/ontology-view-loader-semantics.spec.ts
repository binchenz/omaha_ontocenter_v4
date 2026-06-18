import { OntologyViewLoader } from '../ontology-view-loader.service';

/**
 * ADR-0061 §2 / ADR-0064 §1: the loader lifts the type-level `semantics` JSONB
 * (universe + timeAxis) onto the OntologyView, so the result envelope and any
 * surface can read the star's caliber/cadence structurally. Malformed/absent
 * semantics yield `undefined` (zero weight) — never throw.
 */
function makeLoader(semantics: unknown, properties: any[] = [{ name: 'value', label: 'v', type: 'number', sortable: true }]): OntologyViewLoader {
  const prisma = {
    objectType: { findFirst: jest.fn().mockResolvedValue({ id: 'ot1', name: 'market_metric', properties, dimensions: null, semantics }) },
    objectRelationship: { findMany: jest.fn().mockResolvedValue([]) },
  } as any;
  return new OntologyViewLoader(prisma);
}

describe('OntologyViewLoader — semantics (universe + timeAxis)', () => {
  it('lifts a dense monthly timeAxis onto the view', async () => {
    const view = await makeLoader({ universe: 'whole-market', timeAxis: { field: 'month', grain: 'month', format: 'YY.MM（26.04=2026年4月）', density: 'dense' } }).load('t1', 'market_metric');
    expect(view!.universe).toBe('whole-market');
    expect(view!.timeAxis).toEqual({ field: 'month', grain: 'month', format: 'YY.MM（26.04=2026年4月）', density: 'dense' });
  });

  it('lifts a sparse snapshot timeAxis (no format) onto the view', async () => {
    const view = await makeLoader({ universe: 'whole-market', timeAxis: { field: 'period', grain: 'snapshot', density: 'sparse' } }).load('t1', 'market_metric');
    expect(view!.timeAxis).toEqual({ field: 'period', grain: 'snapshot', density: 'sparse' });
  });

  it('leaves timeAxis undefined when only universe is declared', async () => {
    const view = await makeLoader({ universe: 'top-sample' }).load('t1', 'market_metric');
    expect(view!.universe).toBe('top-sample');
    expect(view!.timeAxis).toBeUndefined();
  });

  it('ignores a malformed timeAxis (bad grain/density) rather than throwing', async () => {
    const view = await makeLoader({ timeAxis: { field: 'month', grain: 'fortnight', density: 'medium' } }).load('t1', 'market_metric');
    expect(view!.timeAxis).toBeUndefined();
  });

  it('leaves both undefined for an empty semantics object', async () => {
    const view = await makeLoader({}).load('t1', 'market_metric');
    expect(view!.universe).toBeUndefined();
    expect(view!.timeAxis).toBeUndefined();
  });
});
