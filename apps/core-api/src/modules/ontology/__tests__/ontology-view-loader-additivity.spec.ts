import { OntologyViewLoader } from '../ontology-view-loader.service';

/**
 * ADR-0061 §1: the loader lifts each property's `additivity` / `ratioOf` into
 * the OntologyView's `additivity` map, so the AdditivityGuard reads structural
 * semantics rather than skill prose. Fields without a tag never enter the map
 * (the guard treats absence as additive).
 */
function makeLoader(properties: any[]): OntologyViewLoader {
  const prisma = {
    objectType: { findFirst: jest.fn().mockResolvedValue({ id: 'ot1', properties, dimensions: null }) },
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
});
