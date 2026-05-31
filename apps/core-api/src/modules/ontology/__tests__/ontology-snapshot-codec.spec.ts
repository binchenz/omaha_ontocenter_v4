import {
  ONTOLOGY_SNAPSHOT_VERSION,
  OntologySnapshotCodec,
  type OntologySnapshot,
} from '@omaha/shared-types';

function fullSnapshot(): OntologySnapshot {
  return {
    version: ONTOLOGY_SNAPSHOT_VERSION,
    objectTypes: [
      {
        name: 'book',
        label: '书籍',
        description: '一本书',
        provenance: 'metadata',
        externalIdCandidates: ['isbn', 'book_code'],
        properties: [
          {
            name: 'isbn',
            label: 'ISBN',
            type: 'string',
            required: true,
            filterable: true,
            provenance: 'metadata',
          },
          {
            name: 'genre',
            label: '题材',
            type: 'string',
            filterable: true,
            allowedValues: ['悬疑', '言情', '历史'],
            allowedValuesUnconfirmed: true,
            provenance: 'heuristic',
          },
          {
            name: 'price',
            label: '价格',
            type: 'number',
            sortable: true,
            unit: '元',
            precision: 10,
            scale: 2,
          },
        ],
        derivedProperties: [
          {
            name: 'discounted',
            label: '折后价',
            type: 'number',
            expression: 'price * 0.8',
            params: [{ name: 'rate', type: 'decimal' }],
            provenance: 'heuristic',
          },
        ],
      },
    ],
    relationships: [
      {
        name: 'book_chapters',
        sourceType: 'book',
        targetType: 'chapter',
        cardinality: 'one-to-many',
        description: '一本书的章节',
        provenance: 'metadata',
      },
    ],
  };
}

describe('OntologySnapshotCodec', () => {
  it('round-trips a full snapshot losslessly, including provenance tags', () => {
    const snap = fullSnapshot();
    const decoded = OntologySnapshotCodec.decode(OntologySnapshotCodec.encode(snap));
    expect(decoded).toEqual(snap);
  });

  it('preserves provenance on types, properties, derived properties, and relationships', () => {
    const decoded = OntologySnapshotCodec.decode(OntologySnapshotCodec.encode(fullSnapshot()));
    expect(decoded.objectTypes[0].provenance).toBe('metadata');
    expect(decoded.objectTypes[0].properties[1].provenance).toBe('heuristic');
    expect(decoded.objectTypes[0].properties[1].allowedValuesUnconfirmed).toBe(true);
    expect(decoded.objectTypes[0].derivedProperties[0].provenance).toBe('heuristic');
    expect(decoded.relationships[0].provenance).toBe('metadata');
    expect(decoded.objectTypes[0].externalIdCandidates).toEqual(['isbn', 'book_code']);
  });

  it('encode produces a JSON-clean plain value', () => {
    const encoded = OntologySnapshotCodec.encode(fullSnapshot());
    expect(() => JSON.stringify(encoded)).not.toThrow();
    expect(JSON.parse(JSON.stringify(encoded))).toEqual(encoded);
  });

  it('normalizes unknown/garbage input into an empty canonical snapshot', () => {
    expect(OntologySnapshotCodec.decode(null)).toEqual({
      version: ONTOLOGY_SNAPSHOT_VERSION,
      objectTypes: [],
      relationships: [],
    });
    expect(OntologySnapshotCodec.decode({ objectTypes: 'nope' }).objectTypes).toEqual([]);
  });

  it('drops unknown keys and fills defaults (label defaults to name, type defaults to string)', () => {
    const decoded = OntologySnapshotCodec.decode({
      objectTypes: [{ name: 'x', bogus: 1, properties: [{ name: 'f', junk: true }] }],
      relationships: [{ name: 'r', sourceType: 'x', targetType: 'y' }],
    });
    expect(decoded.objectTypes[0]).toMatchObject({ name: 'x', label: 'x' });
    expect((decoded.objectTypes[0] as unknown as Record<string, unknown>).bogus).toBeUndefined();
    expect(decoded.objectTypes[0].properties[0]).toEqual({ name: 'f', label: 'f', type: 'string' });
    // cardinality defaults to one-to-many when absent/invalid
    expect(decoded.relationships[0].cardinality).toBe('one-to-many');
  });

  it('coerces an invalid provenance tag to undefined', () => {
    const decoded = OntologySnapshotCodec.decode({
      objectTypes: [{ name: 'x', provenance: 'totally-bogus', properties: [] }],
    });
    expect(decoded.objectTypes[0].provenance).toBeUndefined();
  });
});
