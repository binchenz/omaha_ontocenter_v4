import {
  diffSnapshots,
  hasBreakingChange,
  ONTOLOGY_SNAPSHOT_VERSION,
  type OntologySnapshot,
  type SnapshotChange,
  type SnapshotObjectType,
} from '@omaha/shared-types';

function snap(objectTypes: SnapshotObjectType[], relationships: OntologySnapshot['relationships'] = []): OntologySnapshot {
  return { version: ONTOLOGY_SNAPSHOT_VERSION, objectTypes, relationships };
}

function type(name: string, props: SnapshotObjectType['properties']): SnapshotObjectType {
  return { name, label: name, properties: props, derivedProperties: [] };
}

function find(changes: SnapshotChange[], kind: SnapshotChange['kind'], field?: string): SnapshotChange | undefined {
  return changes.find((c) => c.kind === kind && (field === undefined || c.field === field));
}

const baseBook = type('book', [
  { name: 'isbn', label: 'ISBN', type: 'string', filterable: true },
  { name: 'price', label: '价格', type: 'number', sortable: true },
  { name: 'genre', label: '题材', type: 'string', allowedValues: ['悬疑', '言情', '历史'] },
]);

describe('diffSnapshots — safe (additive) changes pass without breaking', () => {
  it('add-type is safe', () => {
    const changes = diffSnapshots(snap([baseBook]), snap([baseBook, type('author', [])]));
    expect(find(changes, 'add-type', undefined)?.tier).toBe('safe');
    expect(hasBreakingChange(changes)).toBe(false);
  });

  it('add-field is safe', () => {
    const draft = snap([type('book', [...baseBook.properties, { name: 'pages', label: '页数', type: 'number' }])]);
    const changes = diffSnapshots(snap([baseBook]), draft);
    expect(find(changes, 'add-field', 'pages')?.tier).toBe('safe');
    expect(hasBreakingChange(changes)).toBe(false);
  });

  it('editing label/description/unit is safe (edit-field-meta), not flagged breaking (false-positive guard)', () => {
    const draft = snap([type('book', [
      { name: 'isbn', label: 'ISBN', type: 'string', filterable: true },
      { name: 'price', label: '单价', type: 'number', sortable: true, unit: '元', description: '商品单价' },
      baseBook.properties[2],
    ])]);
    const changes = diffSnapshots(snap([baseBook]), draft);
    expect(find(changes, 'edit-field-meta', 'price')?.tier).toBe('safe');
    expect(hasBreakingChange(changes)).toBe(false);
  });

  it('toggling filterable/sortable is safe (toggle-capability)', () => {
    const draft = snap([type('book', [
      { name: 'isbn', label: 'ISBN', type: 'string', filterable: true, sortable: true },
      baseBook.properties[1],
      baseBook.properties[2],
    ])]);
    const changes = diffSnapshots(snap([baseBook]), draft);
    expect(find(changes, 'toggle-capability', 'isbn')?.tier).toBe('safe');
    expect(hasBreakingChange(changes)).toBe(false);
  });

  it('add-relationship is safe', () => {
    const changes = diffSnapshots(
      snap([baseBook]),
      snap([baseBook], [{ name: 'book_author', sourceType: 'book', targetType: 'author', cardinality: 'many-to-many' }]),
    );
    expect(find(changes, 'add-relationship')?.tier).toBe('safe');
    expect(hasBreakingChange(changes)).toBe(false);
  });

  it('WIDENING allowedValues (adding a value) is NOT a restriction (false-positive guard)', () => {
    const draft = snap([type('book', [
      baseBook.properties[0],
      baseBook.properties[1],
      { name: 'genre', label: '题材', type: 'string', allowedValues: ['悬疑', '言情', '历史', '科幻'] },
    ])]);
    const changes = diffSnapshots(snap([baseBook]), draft);
    expect(find(changes, 'restrict-allowed-values', 'genre')).toBeUndefined();
    expect(hasBreakingChange(changes)).toBe(false);
  });

  it('DROPPING the allowedValues constraint entirely is a widening, not breaking (false-positive guard)', () => {
    const draft = snap([type('book', [
      baseBook.properties[0],
      baseBook.properties[1],
      { name: 'genre', label: '题材', type: 'string' },
    ])]);
    const changes = diffSnapshots(snap([baseBook]), draft);
    expect(find(changes, 'restrict-allowed-values', 'genre')).toBeUndefined();
  });
});

describe('diffSnapshots — breaking changes are flagged (false-negative guard)', () => {
  it('drop-type is breaking', () => {
    const changes = diffSnapshots(snap([baseBook, type('author', [])]), snap([baseBook]));
    expect(find(changes, 'drop-type')?.tier).toBe('breaking');
    expect(hasBreakingChange(changes)).toBe(true);
  });

  it('drop-field is breaking', () => {
    const draft = snap([type('book', [baseBook.properties[0], baseBook.properties[2]])]);
    const changes = diffSnapshots(snap([baseBook]), draft);
    expect(find(changes, 'drop-field', 'price')?.tier).toBe('breaking');
  });

  it('change-field-type is breaking', () => {
    const draft = snap([type('book', [
      baseBook.properties[0],
      { name: 'price', label: '价格', type: 'string' },
      baseBook.properties[2],
    ])]);
    const changes = diffSnapshots(snap([baseBook]), draft);
    expect(find(changes, 'change-field-type', 'price')?.tier).toBe('breaking');
  });

  it('TIGHTENING allowedValues (removing a legal value) is breaking', () => {
    const draft = snap([type('book', [
      baseBook.properties[0],
      baseBook.properties[1],
      { name: 'genre', label: '题材', type: 'string', allowedValues: ['悬疑', '言情'] },
    ])]);
    const changes = diffSnapshots(snap([baseBook]), draft);
    expect(find(changes, 'restrict-allowed-values', 'genre')?.tier).toBe('breaking');
  });

  it('ADDING an allowedValues constraint where none existed is breaking', () => {
    const pub = snap([type('book', [
      baseBook.properties[0],
      baseBook.properties[1],
      { name: 'genre', label: '题材', type: 'string' },
    ])]);
    const draft = snap([baseBook]);
    const changes = diffSnapshots(pub, draft);
    expect(find(changes, 'restrict-allowed-values', 'genre')?.tier).toBe('breaking');
  });

  it('drop-relationship is breaking', () => {
    const changes = diffSnapshots(
      snap([baseBook], [{ name: 'book_author', sourceType: 'book', targetType: 'author', cardinality: 'many-to-many' }]),
      snap([baseBook]),
    );
    expect(find(changes, 'drop-relationship')?.tier).toBe('breaking');
    expect(hasBreakingChange(changes)).toBe(true);
  });
});

describe('diffSnapshots — no-op', () => {
  it('an identical draft yields no changes', () => {
    expect(diffSnapshots(snap([baseBook]), snap([baseBook]))).toEqual([]);
  });
});
