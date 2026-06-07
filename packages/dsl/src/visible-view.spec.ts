import { projectVisible, visibleClosure } from './visible-view';
import type { OntologyView } from './ontology-view';

function makeView(over: Partial<OntologyView> = {}): OntologyView {
  return {
    tenantId: 't1',
    objectType: 'Order',
    numericFields: new Set(['amount', 'paidAmount', 'tax']),
    booleanFields: new Set(['flagged']),
    stringFields: new Set(['status', 'customerName']),
    filterableFields: new Set(['amount', 'status', 'paidAmount', 'customerName']),
    sortableFields: new Set(['amount', 'paidAmount']),
    relations: { items: { storageKey: 'items', otherType: 'order_item', fkSide: 'other' } },
    derivedProperties: new Map([
      // isPaid depends on a masked base field (paidAmount)
      ['isPaid', { name: 'isPaid', expression: 'paidAmount >= amount' }],
      // displayStatus depends only on a visible base field (status)
      ['displayStatus', { name: 'displayStatus', expression: 'status' }],
      // netView depends on another derived (isPaid) → transitive
      ['netView', { name: 'netView', expression: 'isPaid' }],
      // itemCount depends on a relation, not a field → relation pass-through
      ['itemCount', { name: 'itemCount', expression: 'count(items)' }],
    ]),
    ...over,
  };
}

describe('visibleClosure', () => {
  it('returns null (⊤) unchanged', () => {
    expect(visibleClosure(makeView(), null)).toBeNull();
  });

  it('keeps base fields that are allowed, drops others', () => {
    const c = visibleClosure(makeView(), new Set(['amount', 'status']))!;
    expect(c.has('amount')).toBe(true);
    expect(c.has('status')).toBe(true);
    expect(c.has('paidAmount')).toBe(false);
  });

  it('hides a derived property when a base field in its closure is masked', () => {
    // paidAmount masked ⇒ isPaid (paidAmount>=amount) must be hidden, and
    // netView (=isPaid) transitively hidden too.
    const c = visibleClosure(makeView(), new Set(['amount', 'status']))!;
    expect(c.has('isPaid')).toBe(false);
    expect(c.has('netView')).toBe(false);
  });

  it('keeps a derived property when its entire base closure is visible', () => {
    const c = visibleClosure(makeView(), new Set(['status']))!;
    expect(c.has('displayStatus')).toBe(true);
  });

  it('keeps a derived property whose only dependency is a relation (pass-through)', () => {
    // itemCount = count(items); items is a relation, not a maskable field.
    const c = visibleClosure(makeView(), new Set(['status']))!;
    expect(c.has('itemCount')).toBe(true);
  });

  it('reveals the derived property once its masked base becomes visible', () => {
    const c = visibleClosure(makeView(), new Set(['amount', 'paidAmount']))!;
    expect(c.has('isPaid')).toBe(true);
    expect(c.has('netView')).toBe(true);
  });
});

describe('projectVisible', () => {
  it('returns the same view reference for ⊤ (no allocation)', () => {
    const v = makeView();
    expect(projectVisible(v, null)).toBe(v);
  });

  it('never mutates the input view', () => {
    const v = makeView();
    const beforeNumeric = new Set(v.numericFields);
    const beforeDerived = [...v.derivedProperties.keys()];
    projectVisible(v, new Set(['amount']));
    expect(v.numericFields).toEqual(beforeNumeric);
    expect([...v.derivedProperties.keys()]).toEqual(beforeDerived);
  });

  it('narrows numericFields so a masked numeric field cannot back a sum/avg metric', () => {
    const p = projectVisible(makeView(), new Set(['amount', 'status']));
    expect(p.numericFields.has('amount')).toBe(true);
    expect(p.numericFields.has('paidAmount')).toBe(false);
    expect(p.numericFields.has('tax')).toBe(false);
  });

  it('narrows filterableFields and sortableFields', () => {
    const p = projectVisible(makeView(), new Set(['amount', 'status']));
    expect(p.filterableFields.has('paidAmount')).toBe(false);
    expect(p.sortableFields.has('paidAmount')).toBe(false);
    expect(p.filterableFields.has('amount')).toBe(true);
  });

  it('prunes derived properties whose base closure is masked', () => {
    const p = projectVisible(makeView(), new Set(['amount', 'status']));
    expect(p.derivedProperties.has('isPaid')).toBe(false);
    expect(p.derivedProperties.has('netView')).toBe(false);
    expect(p.derivedProperties.has('displayStatus')).toBe(true);
    expect(p.derivedProperties.has('itemCount')).toBe(true);
  });

  it('leaves relations intact', () => {
    const p = projectVisible(makeView(), new Set(['status']));
    expect(p.relations).toEqual({ items: { storageKey: 'items', otherType: 'order_item', fkSide: 'other' } });
  });
});
