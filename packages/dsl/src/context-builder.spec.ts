import { buildCompileContext } from './context-builder';
import type { OntologyView } from './ontology-view';

function minimalView(overrides: Partial<OntologyView> = {}): OntologyView {
  return {
    tenantId: 't1',
    objectType: 'customer',
    numericFields: new Set(),
    booleanFields: new Set(),
    stringFields: new Set(),
    filterableFields: new Set(),
    sortableFields: new Set(),
    relations: {},
    derivedProperties: new Map(),
    ...overrides,
  };
}

describe('buildCompileContext', () => {
  it('extracts numericFields from the view', () => {
    const view = minimalView({
      numericFields: new Set(['revenue', 'margin']),
    });
    const ctx = buildCompileContext(view);
    expect(ctx.numericFields).toEqual(new Set(['revenue', 'margin']));
  });

  it('extracts booleanFields from the view', () => {
    const view = minimalView({
      booleanFields: new Set(['active', 'verified']),
    });
    const ctx = buildCompileContext(view);
    expect(ctx.booleanFields).toEqual(new Set(['active', 'verified']));
  });

  it('extracts stringFields from the view', () => {
    const view = minimalView({
      stringFields: new Set(['region', 'status']),
    });
    const ctx = buildCompileContext(view);
    expect(ctx.stringFields).toEqual(new Set(['region', 'status']));
  });

  it('extracts relations from the view', () => {
    const view = minimalView({
      relations: {
        orders: { storageKey: 'orderId', otherType: 'order', fkSide: 'other' },
        payments: { storageKey: 'paymentId', otherType: 'payment', fkSide: 'self' },
      },
    });
    const ctx = buildCompileContext(view);
    expect(ctx.relations).toEqual({
      orders: { storageKey: 'orderId', otherType: 'order', fkSide: 'other' },
      payments: { storageKey: 'paymentId', otherType: 'payment', fkSide: 'self' },
    });
  });

  it('defaults params to empty object when not provided', () => {
    const view = minimalView();
    const ctx = buildCompileContext(view);
    expect(ctx.params).toEqual({});
  });

  it('merges provided params into the context', () => {
    const view = minimalView();
    const ctx = buildCompileContext(view, { minThreshold: 100, cutoffDate: '2026-01-01' });
    expect(ctx.params).toEqual({ minThreshold: 100, cutoffDate: '2026-01-01' });
  });

  it('builds a complete context with all field types, relations, and params', () => {
    const view = minimalView({
      numericFields: new Set(['amount']),
      booleanFields: new Set(['paid']),
      stringFields: new Set(['status']),
      relations: {
        lineItems: { storageKey: 'lineItemId', otherType: 'lineItem', fkSide: 'other' },
      },
    });
    const ctx = buildCompileContext(view, { maxAmount: 1000 });
    expect(ctx).toEqual({
      numericFields: new Set(['amount']),
      booleanFields: new Set(['paid']),
      stringFields: new Set(['status']),
      relations: {
        lineItems: { storageKey: 'lineItemId', otherType: 'lineItem', fkSide: 'other' },
      },
      params: { maxAmount: 1000 },
    });
  });

  it('handles empty sets and empty relations map', () => {
    const view = minimalView({
      numericFields: new Set(),
      booleanFields: new Set(),
      stringFields: new Set(),
      relations: {},
    });
    const ctx = buildCompileContext(view);
    expect(ctx.numericFields).toEqual(new Set());
    expect(ctx.booleanFields).toEqual(new Set());
    expect(ctx.stringFields).toEqual(new Set());
    expect(ctx.relations).toEqual({});
    expect(ctx.params).toEqual({});
  });

  it('is a pure function - does not mutate the view', () => {
    const view = minimalView({
      numericFields: new Set(['x']),
    });
    const originalNumericFields = view.numericFields;
    buildCompileContext(view);
    expect(view.numericFields).toBe(originalNumericFields);
  });

  it('is a pure function - does not mutate the params', () => {
    const view = minimalView();
    const params = { foo: 'bar' };
    const ctx = buildCompileContext(view, params);
    expect(ctx.params).toEqual({ foo: 'bar' });
    // Efficiency: pass by reference instead of shallow copy — the DSL compiler
    // only reads from ctx.params, never writes to it. This test changed from
    // .not.toBe to .toBe to document that optimization.
    expect(ctx.params).toBe(params);
  });
});
