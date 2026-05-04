import { emit } from './predicate';
import type { Predicate } from './predicate';
import type { OntologyView } from './ontology-view';
import { parse } from './parser';

function fixtureView(): OntologyView {
  return {
    tenantId: '11111111-1111-1111-1111-111111111111',
    objectType: 'order',
    numericFields: new Set(['totalAmount']),
    booleanFields: new Set(),
    stringFields: new Set(['city']),
    filterableFields: new Set(['totalAmount', 'city']),
    sortableFields: new Set(['totalAmount']),
    relations: { payments: { foreignKey: 'orderId' } },
    derivedProperties: new Map(),
  };
}

describe('Predicate emit', () => {
  it('emits a numeric comparison against parent scope', () => {
    const predicate: Predicate = {
      ast: parse('totalAmount >= 1000'),
      view: fixtureView(),
      params: {},
      scope: 'parent',
    };
    const { sql, params } = emit(predicate);
    expect(sql).toBe(`((properties->>'totalAmount')::numeric >= $1)`);
    expect(params).toEqual([1000]);
  });

  it('resolves :userId from Predicate.params, never from a string-level substitution', () => {
    const predicate: Predicate = {
      ast: parse('city = :city'),
      view: fixtureView(),
      params: { city: 'Hangzhou' },
      scope: 'parent',
    };
    const { sql, params } = emit(predicate);
    expect(sql).toBe(`((properties->>'city') = $1)`);
    expect(params).toEqual(['Hangzhou']);
  });

  it('refuses to emit when a referenced param is not bound', () => {
    const predicate: Predicate = {
      ast: parse('city = :city'),
      view: fixtureView(),
      params: {},
      scope: 'parent',
    };
    expect(() => emit(predicate)).toThrow(/missing parameter.*city/i);
  });
});
