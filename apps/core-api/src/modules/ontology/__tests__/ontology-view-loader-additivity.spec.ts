import { OntologyViewLoader } from '../ontology-view-loader.service';

/**
 * ADR-0061 §1: the loader lifts each property's `additivity` / `ratioOf` into
 * the OntologyView's `additivity` map, so the AdditivityGuard reads structural
 * semantics rather than skill prose. Fields without a tag never enter the map
 * (the guard treats absence as additive).
 *
 * Slice C: also lifts derivedProperties' additivity into the same map.
 */
function makeLoader(properties: any[], derivedProperties?: any[]): OntologyViewLoader {
  const prisma = {
    objectType: { findFirst: jest.fn().mockResolvedValue({ id: 'ot1', properties, derivedProperties: derivedProperties ?? [], dimensions: null }) },
    objectRelationship: { findMany: jest.fn().mockResolvedValue([]) },
  } as any;
  return new OntologyViewLoader(prisma);
}

describe('OntologyViewLoader — additivity (ADR-0061)', () => {
  it('maps a non-additive field into the additivity map', async () => {
    const loader = makeLoader([
      { name: 'value', label: '份额', type: 'number', additivity: 'non-additive' },
    ]);
    const view = await loader.load('t1', 'brand_share');
    expect(view!.additivity!.get('value')).toEqual({ kind: 'non-additive' });
  });

  it('maps a ratio field with ratioOf weight columns', async () => {
    const loader = makeLoader([
      { name: 'avgPrice', label: '均价', type: 'number', additivity: 'ratio', ratioOf: { numerator: 'amount', denominator: 'qty' } },
    ]);
    const view = await loader.load('t1', 'm');
    expect(view!.additivity!.get('avgPrice')).toEqual({ kind: 'ratio', ratioOf: { numerator: 'amount', denominator: 'qty' } });
  });

  it('omits untagged fields from the additivity map', async () => {
    const loader = makeLoader([
      { name: 'value', label: 'v', type: 'number', additivity: 'additive' },
      { name: 'plain', label: 'p', type: 'number' },
    ]);
    const view = await loader.load('t1', 'm');
    expect(view!.additivity!.has('plain')).toBe(false);
    expect(view!.additivity!.get('value')).toEqual({ kind: 'additive' });
  });

  it('leaves additivity undefined when no field is tagged', async () => {
    const loader = makeLoader([{ name: 'plain', label: 'p', type: 'number' }]);
    const view = await loader.load('t1', 'm');
    expect(view!.additivity).toBeUndefined();
  });

  describe('derived field additivity (Slice C)', () => {
    it('maps a non-additive derived field into the additivity map', async () => {
      const loader = makeLoader(
        [{ name: 'base', label: 'b', type: 'number' }],
        [{ name: 'yoy_growth', label: 'YoY增长', type: 'number', expression: '(value - lag(value)) / lag(value)', additivity: 'non-additive' }],
      );
      const view = await loader.load('t1', 'metrics');
      expect(view!.additivity!.get('yoy_growth')).toEqual({ kind: 'non-additive' });
    });

    it('maps a ratio derived field into the additivity map', async () => {
      const loader = makeLoader(
        [{ name: 'a', label: 'a', type: 'number' }, { name: 'b', label: 'b', type: 'number' }],
        [{ name: 'market_share_derived', label: '份额', type: 'number', expression: 'a / b', additivity: 'ratio' }],
      );
      const view = await loader.load('t1', 'metrics');
      expect(view!.additivity!.get('market_share_derived')).toEqual({ kind: 'ratio' });
    });

    it('includes both regular and derived fields in the additivity map', async () => {
      const loader = makeLoader(
        [{ name: 'value', label: 'v', type: 'number', additivity: 'additive' }],
        [{ name: 'yoy_growth', label: 'g', type: 'number', expression: 'delta / lag', additivity: 'non-additive' }],
      );
      const view = await loader.load('t1', 'metrics');
      expect(view!.additivity!.get('value')).toEqual({ kind: 'additive' });
      expect(view!.additivity!.get('yoy_growth')).toEqual({ kind: 'non-additive' });
      expect(view!.additivity!.size).toBe(2);
    });

    it('omits untagged derived fields from the additivity map', async () => {
      const loader = makeLoader(
        [{ name: 'base', label: 'b', type: 'number' }],
        [{ name: 'computed', label: 'c', type: 'number', expression: 'base * 2' }],
      );
      const view = await loader.load('t1', 'metrics');
      expect(view!.additivity).toBeUndefined();
    });
  });
});
