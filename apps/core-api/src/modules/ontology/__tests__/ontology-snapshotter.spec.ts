import {
  flattenSnapshot,
  rowsToSnapshot,
  toProductionDerivedProperties,
  toProductionProperties,
  type OntologyRowSet,
  type OntologySnapshot,
} from '@omaha/shared-types';

function rowSet(): OntologyRowSet {
  return {
    types: [
      {
        id: 'book-id',
        name: 'book',
        label: '书籍',
        description: '一本书',
        properties: [
          { name: 'isbn', label: 'ISBN', type: 'string', filterable: true },
          { name: 'price', label: '价格', type: 'number', sortable: true, unit: '元' },
        ],
        derivedProperties: [
          { name: 'discounted', label: '折后价', type: 'number', expression: 'price * 0.8' },
        ],
      },
      {
        id: 'chapter-id',
        name: 'chapter',
        label: '章节',
        properties: [{ name: 'title', label: '标题', type: 'string' }],
        derivedProperties: [],
      },
    ],
    relationships: [
      {
        id: 'rel-id',
        name: 'book_chapters',
        sourceTypeName: 'book',
        targetTypeName: 'chapter',
        cardinality: 'one-to-many',
        description: '章节',
      },
    ],
  };
}

describe('Snapshotter (rows → snapshot)', () => {
  it('produces a normalized snapshot dropping DB ids and using type names in relationships', () => {
    const snap = rowsToSnapshot(rowSet());
    expect(snap.objectTypes.map((t) => t.name).sort()).toEqual(['book', 'chapter']);
    const book = snap.objectTypes.find((t) => t.name === 'book')!;
    expect(book.properties.map((p) => p.name)).toEqual(['isbn', 'price']);
    expect((book as unknown as Record<string, unknown>).id).toBeUndefined();
    expect(snap.relationships[0]).toMatchObject({
      name: 'book_chapters',
      sourceType: 'book',
      targetType: 'chapter',
      cardinality: 'one-to-many',
    });
  });
});

describe('Flattener (snapshot → row operations)', () => {
  it('round-trips: snapshot of unchanged rows produces only updates, no creates/deletes', () => {
    const rows = rowSet();
    const snap = rowsToSnapshot(rows);
    const plan = flattenSnapshot(rows, snap);
    expect(plan.createTypes).toEqual([]);
    expect(plan.deleteTypes).toEqual([]);
    expect(plan.updateTypes.map((u) => u.id).sort()).toEqual(['book-id', 'chapter-id']);
    expect(plan.createRelationships).toEqual([]);
    expect(plan.deleteRelationships).toEqual([]);
  });

  it('snapshot → rows → snapshot loses nothing (round-trip fidelity)', () => {
    const snap1 = rowsToSnapshot(rowSet());
    // Re-encode the snapshot as if it were freshly decoded — must be stable.
    const snap2 = rowsToSnapshot({
      types: snap1.objectTypes.map((t, i) => ({
        id: `id-${i}`,
        name: t.name,
        label: t.label,
        description: t.description,
        properties: t.properties,
        derivedProperties: t.derivedProperties,
      })),
      relationships: snap1.relationships.map((r, i) => ({
        id: `rid-${i}`,
        name: r.name,
        sourceTypeName: r.sourceType,
        targetTypeName: r.targetType,
        cardinality: r.cardinality,
        description: r.description,
      })),
    });
    expect(snap2).toEqual(snap1);
  });

  it('classifies a new type as create and a removed type as delete', () => {
    const rows = rowSet();
    const snap = rowsToSnapshot(rows);
    const draft: OntologySnapshot = {
      ...snap,
      objectTypes: [
        ...snap.objectTypes.filter((t) => t.name !== 'chapter'),
        { name: 'author', label: '作者', properties: [], derivedProperties: [] },
      ],
    };
    const plan = flattenSnapshot(rows, draft);
    expect(plan.createTypes.map((t) => t.name)).toEqual(['author']);
    expect(plan.deleteTypes.map((t) => t.name)).toEqual(['chapter']);
    // book stays → update
    expect(plan.updateTypes.map((u) => u.id)).toEqual(['book-id']);
  });

  it('classifies new and removed relationships, carrying ids for deletes', () => {
    const rows = rowSet();
    const snap = rowsToSnapshot(rows);
    const draft: OntologySnapshot = {
      ...snap,
      relationships: [
        { name: 'book_author', sourceType: 'book', targetType: 'author', cardinality: 'many-to-many' },
      ],
    };
    const plan = flattenSnapshot(rows, draft);
    expect(plan.createRelationships.map((r) => r.name)).toEqual(['book_author']);
    expect(plan.deleteRelationships).toEqual([{ id: 'rel-id', name: 'book_chapters', sourceType: 'book' }]);
  });
});

describe('toProductionProperties / toProductionDerivedProperties', () => {
  it('strips snapshot-only tags (provenance, allowedValuesUnconfirmed)', () => {
    const props = toProductionProperties({
      name: 't',
      label: 'T',
      properties: [
        {
          name: 'g',
          label: 'G',
          type: 'string',
          allowedValues: ['a'],
          allowedValuesUnconfirmed: true,
          provenance: 'heuristic',
        },
      ],
      derivedProperties: [],
    });
    expect(props[0]).toEqual({ name: 'g', label: 'G', type: 'string', allowedValues: ['a'] });
    expect((props[0] as unknown as Record<string, unknown>).provenance).toBeUndefined();

    const derived = toProductionDerivedProperties({
      name: 't',
      label: 'T',
      properties: [],
      derivedProperties: [
        { name: 'd', label: 'D', type: 'number', expression: 'x+1', provenance: 'heuristic' },
      ],
    });
    expect(derived[0]).toEqual({ name: 'd', label: 'D', type: 'number', expression: 'x+1' });
  });
});
