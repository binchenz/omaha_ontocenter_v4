import {
  validateSnapshot,
  ONTOLOGY_SNAPSHOT_VERSION,
  type OntologySnapshot,
  type SnapshotObjectType,
} from '@omaha/shared-types';

function snap(objectTypes: SnapshotObjectType[], relationships: OntologySnapshot['relationships'] = []): OntologySnapshot {
  return { version: ONTOLOGY_SNAPSHOT_VERSION, objectTypes, relationships };
}

describe('validateSnapshot', () => {
  it('accepts a well-formed snapshot', () => {
    const s = snap(
      [
        {
          name: 'book',
          label: '书',
          properties: [
            { name: 'isbn', label: 'ISBN', type: 'string' },
            { name: 'genre', label: '题材', type: 'string', allowedValues: ['a', 'b'] },
          ],
          derivedProperties: [],
        },
        { name: 'chapter', label: '章', properties: [], derivedProperties: [] },
      ],
      [{ name: 'book_chapters', sourceType: 'book', targetType: 'chapter', cardinality: 'one-to-many' }],
    );
    expect(validateSnapshot(s)).toEqual([]);
  });

  it('flags a duplicate object-type name', () => {
    const s = snap([
      { name: 'book', label: '书', properties: [], derivedProperties: [] },
      { name: 'book', label: '书2', properties: [], derivedProperties: [] },
    ]);
    expect(validateSnapshot(s).some((e) => e.message.includes('重复'))).toBe(true);
  });

  it('flags a duplicate field name within a type', () => {
    const s = snap([
      {
        name: 'book',
        label: '书',
        properties: [
          { name: 'x', label: 'X', type: 'string' },
          { name: 'x', label: 'X2', type: 'number' },
        ],
        derivedProperties: [],
      },
    ]);
    expect(validateSnapshot(s).some((e) => e.path === 'book.x')).toBe(true);
  });

  it('flags allowedValues on a non-string field', () => {
    const s = snap([
      {
        name: 'book',
        label: '书',
        properties: [{ name: 'p', label: 'P', type: 'number', allowedValues: ['1'] }],
        derivedProperties: [],
      },
    ]);
    expect(validateSnapshot(s).some((e) => e.message.includes('string'))).toBe(true);
  });

  it('flags allowedValues with duplicates and empty strings', () => {
    const dup = snap([
      { name: 't', label: 'T', properties: [{ name: 'p', label: 'P', type: 'string', allowedValues: ['a', 'a'] }], derivedProperties: [] },
    ]);
    expect(validateSnapshot(dup).some((e) => e.message.includes('重复'))).toBe(true);

    const empty = snap([
      { name: 't', label: 'T', properties: [{ name: 'p', label: 'P', type: 'string', allowedValues: ['a', '  '] }], derivedProperties: [] },
    ]);
    expect(validateSnapshot(empty).some((e) => e.message.includes('空字符串'))).toBe(true);
  });

  it('flags a relationship referencing a type missing from the snapshot', () => {
    const s = snap(
      [{ name: 'book', label: '书', properties: [], derivedProperties: [] }],
      [{ name: 'r', sourceType: 'book', targetType: 'ghost', cardinality: 'one-to-many' }],
    );
    expect(validateSnapshot(s).some((e) => e.message.includes('ghost'))).toBe(true);
  });
});
