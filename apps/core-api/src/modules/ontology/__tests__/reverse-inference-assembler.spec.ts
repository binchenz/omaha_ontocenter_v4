import {
  assembleSnapshotFromDbMetadata,
  mergeSnapshots,
  ONTOLOGY_SNAPSHOT_VERSION,
  type OntologySnapshot,
  type ReverseInferenceInput,
} from '@omaha/shared-types';

const input: ReverseInferenceInput = {
  tables: ['author', 'book'],
  columnsByTable: {
    author: [
      { name: 'id', dbType: 'uuid', nullable: false },
      { name: 'name', dbType: 'varchar(100)', nullable: false },
    ],
    book: [
      { name: 'id', dbType: 'uuid', nullable: false },
      { name: 'isbn', dbType: 'varchar(13)', nullable: false },
      { name: 'price', dbType: 'decimal(10,2)', nullable: true },
      { name: 'published_at', dbType: 'timestamp', nullable: true },
      { name: 'author_id', dbType: 'uuid', nullable: false },
    ],
  },
  foreignKeys: [
    { sourceTable: 'book', sourceColumn: 'author_id', targetTable: 'author', targetColumn: 'id' },
  ],
  uniqueIndexes: [
    { table: 'author', column: 'id' },
    { table: 'book', column: 'id' },
    { table: 'book', column: 'isbn' },
  ],
};

describe('assembleSnapshotFromDbMetadata', () => {
  const snap = assembleSnapshotFromDbMetadata(input);

  it('creates one object type per table, tagged metadata', () => {
    expect(snap.objectTypes.map((t) => t.name).sort()).toEqual(['author', 'book']);
    expect(snap.objectTypes.every((t) => t.provenance === 'metadata')).toBe(true);
  });

  it('maps declared column types to ontology types (metadata provenance)', () => {
    const book = snap.objectTypes.find((t) => t.name === 'book')!;
    const price = book.properties.find((p) => p.name === 'price')!;
    expect(price.type).toBe('number');
    expect(price.provenance).toBe('metadata');
    const pub = book.properties.find((p) => p.name === 'published_at')!;
    expect(pub.type).toBe('date');
    const isbn = book.properties.find((p) => p.name === 'isbn')!;
    expect(isbn.type).toBe('string');
    expect(isbn.required).toBe(true); // NOT NULL
  });

  it('excludes the FK column from plain properties (it becomes the relationship)', () => {
    const book = snap.objectTypes.find((t) => t.name === 'book')!;
    expect(book.properties.map((p) => p.name)).not.toContain('author_id');
  });

  it('infers a one-to-many relationship from the FK, tagged metadata', () => {
    expect(snap.relationships).toHaveLength(1);
    const rel = snap.relationships[0];
    expect(rel).toMatchObject({ sourceType: 'author', targetType: 'book', cardinality: 'one-to-many', provenance: 'metadata' });
  });

  it('offers unique columns as externalId candidates (excluding FK columns)', () => {
    const book = snap.objectTypes.find((t) => t.name === 'book')!;
    expect(book.externalIdCandidates).toEqual(['id', 'isbn']);
  });

  it('drops FK relationships pointing to tables outside the inferred set', () => {
    const partial = assembleSnapshotFromDbMetadata({
      ...input,
      tables: ['book'], // author excluded
      columnsByTable: { book: input.columnsByTable.book },
    });
    expect(partial.relationships).toHaveLength(0);
  });

  it('disambiguates two FKs between the same table pair (no duplicate relationship names)', () => {
    // e.g. a join table edge(from_node, to_node) both referencing node(id).
    const snap = assembleSnapshotFromDbMetadata({
      tables: ['node', 'edge'],
      columnsByTable: {
        node: [{ name: 'id', dbType: 'uuid', nullable: false }],
        edge: [
          { name: 'id', dbType: 'uuid', nullable: false },
          { name: 'from_node', dbType: 'uuid', nullable: false },
          { name: 'to_node', dbType: 'uuid', nullable: false },
        ],
      },
      foreignKeys: [
        { sourceTable: 'edge', sourceColumn: 'from_node', targetTable: 'node', targetColumn: 'id' },
        { sourceTable: 'edge', sourceColumn: 'to_node', targetTable: 'node', targetColumn: 'id' },
      ],
      uniqueIndexes: [],
    });
    expect(snap.relationships).toHaveLength(2);
    const names = snap.relationships.map((r) => r.name);
    expect(new Set(names).size).toBe(2); // unique
  });
});

describe('allowedValues sampling (#74)', () => {
  const base: ReverseInferenceInput = {
    tables: ['order'],
    columnsByTable: {
      order: [
        { name: 'id', dbType: 'uuid', nullable: false },
        { name: 'status', dbType: 'varchar(20)', nullable: false },
        { name: 'note', dbType: 'text', nullable: true },
      ],
    },
    foreignKeys: [],
    uniqueIndexes: [],
  };

  it('infers allowedValues for a low-cardinality, fully-scanned string column, red-flagged heuristic', () => {
    const snap = assembleSnapshotFromDbMetadata({
      ...base,
      samples: [{ table: 'order', column: 'status', distinctValues: ['pending', 'paid', 'refunded'], truncated: false }],
    });
    const status = snap.objectTypes[0].properties.find((p) => p.name === 'status')!;
    expect(status.allowedValues).toEqual(['pending', 'paid', 'refunded']);
    expect(status.allowedValuesUnconfirmed).toBe(true);
    expect(status.provenance).toBe('heuristic'); // sampled, not metadata
    expect(status.filterable).toBe(true);
  });

  it('does NOT infer allowedValues when the distinct scan was truncated (sample may be incomplete)', () => {
    const snap = assembleSnapshotFromDbMetadata({
      ...base,
      samples: [{ table: 'order', column: 'status', distinctValues: ['a', 'b', 'c'], truncated: true }],
    });
    const status = snap.objectTypes[0].properties.find((p) => p.name === 'status')!;
    expect(status.allowedValues).toBeUndefined();
    // declared-type provenance retained when no value set is inferred
    expect(status.provenance).toBe('metadata');
  });

  it('does NOT infer allowedValues for a high-cardinality column (free text)', () => {
    const many = Array.from({ length: 30 }, (_, i) => `v${i}`);
    const snap = assembleSnapshotFromDbMetadata({
      ...base,
      samples: [{ table: 'order', column: 'note', distinctValues: many, truncated: false }],
    });
    const note = snap.objectTypes[0].properties.find((p) => p.name === 'note')!;
    expect(note.allowedValues).toBeUndefined();
  });
});

describe('mergeSnapshots (incremental re-entry, #74)', () => {
  it('preserves existing types/relationships and appends only new ones', () => {
    const existing: OntologySnapshot = {
      version: ONTOLOGY_SNAPSHOT_VERSION,
      objectTypes: [
        // author already edited by the OPC (custom label) — must be preserved
        { name: 'author', label: '作者（已编辑）', properties: [{ name: 'name', label: '姓名', type: 'string' }], derivedProperties: [] },
      ],
      relationships: [],
    };
    const incoming = assembleSnapshotFromDbMetadata(input);
    const merged = mergeSnapshots(existing, incoming);

    // author kept verbatim (OPC edit wins)
    const author = merged.objectTypes.find((t) => t.name === 'author')!;
    expect(author.label).toBe('作者（已编辑）');
    expect(author.properties[0].label).toBe('姓名');
    // book is new → appended
    expect(merged.objectTypes.map((t) => t.name).sort()).toEqual(['author', 'book']);
    // new FK relationship appended
    expect(merged.relationships).toHaveLength(1);
  });
});
