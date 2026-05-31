import { classifyProvenance, mapColumnType } from '@omaha/shared-types';

describe('mapColumnType — declared SQL type → ontology type', () => {
  it('maps numeric families to number', () => {
    for (const t of ['int', 'integer', 'bigint', 'decimal(10,2)', 'numeric', 'double precision', 'real', 'serial']) {
      expect(mapColumnType(t)).toBe('number');
    }
  });
  it('maps date/time families to date', () => {
    for (const t of ['timestamp', 'timestamptz', 'datetime', 'date', 'time']) {
      expect(mapColumnType(t)).toBe('date');
    }
  });
  it('maps bool/bit to boolean', () => {
    expect(mapColumnType('boolean')).toBe('boolean');
    expect(mapColumnType('bit')).toBe('boolean');
  });
  it('maps json/jsonb to json', () => {
    expect(mapColumnType('jsonb')).toBe('json');
  });
  it('maps varchar/text/uuid/enum to string', () => {
    for (const t of ['varchar(20)', 'text', 'char(2)', 'uuid', 'enum']) {
      expect(mapColumnType(t)).toBe('string');
    }
  });
  it('keeps a declared varchar phone/zip as string even though values look numeric', () => {
    expect(mapColumnType('varchar(11)')).toBe('string');
  });
});

describe('classifyProvenance — the ADR-0032 rule table', () => {
  it('declared column type → metadata', () => {
    expect(classifyProvenance({ kind: 'declared-type' })).toBe('metadata');
  });
  it('FK-backed relationship → metadata', () => {
    expect(classifyProvenance({ kind: 'fk-relationship' })).toBe('metadata');
  });
  it('naming-convention relationship without FK → heuristic', () => {
    expect(classifyProvenance({ kind: 'naming-relationship' })).toBe('heuristic');
  });
  it('allowedValues from value sampling → heuristic', () => {
    expect(classifyProvenance({ kind: 'sampled-allowed-values' })).toBe('heuristic');
  });
  it('LLM-inferred description/unit → heuristic', () => {
    expect(classifyProvenance({ kind: 'llm-annotation' })).toBe('heuristic');
  });
  it('UNIQUE column offered as externalId → candidate', () => {
    expect(classifyProvenance({ kind: 'unique-column' })).toBe('candidate');
  });
});
