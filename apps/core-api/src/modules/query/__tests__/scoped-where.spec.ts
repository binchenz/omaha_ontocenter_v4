import { ScopedWhere } from '../scoped-where';
import { BadRequestException } from '@nestjs/common';
import { parentScope, parse, type OntologyView, type Predicate } from '@omaha/dsl';
import type { QueryFilter } from '@omaha/shared-types';

function view(overrides: Partial<OntologyView> = {}): OntologyView {
  return {
    tenantId: 't1',
    objectType: 'order',
    numericFields: new Set(['amount']),
    booleanFields: new Set(['paid']),
    stringFields: new Set(['status']),
    filterableFields: new Set(['amount', 'status', 'paid']),
    sortableFields: new Set(['amount']),
    relations: {},
    derivedProperties: new Map(),
    ...overrides,
  };
}

const scope = parentScope({ tenantId: 't1', objectType: 'order' });

describe('ScopedWhere', () => {
  it('seeds tenant/objectType params from the scope and strips the FROM prefix by default', () => {
    const { where, fromWhere, params } = new ScopedWhere(scope).build();
    expect(where).toBe(`tenant_id = $1::uuid AND object_type = $2 AND deleted_at IS NULL`);
    expect(fromWhere).toBe(`FROM object_instances WHERE ${where}`);
    expect(params).toEqual(['t1', 'order']);
  });

  it('degrades scope to 1=1 and seeds no params under useView', () => {
    const { where, params } = new ScopedWhere(scope, { useView: true }).build();
    expect(where).toBe('1=1');
    expect(params).toEqual([]);
  });

  it('keepFrom preserves the FROM prefix and raw() renumbers ? to the running offset', () => {
    const { fromWhere, params } = new ScopedWhere(scope, { keepFrom: true })
      .raw('(relationships->>?) = ANY(?::text[])', 'orderId', ['a', 'b'])
      .build();
    // scope seeded $1,$2 → raw placeholders become $3,$4
    expect(fromWhere).toBe(
      `FROM object_instances WHERE tenant_id = $1::uuid AND object_type = $2 AND deleted_at IS NULL AND (relationships->>$3) = ANY($4::text[])`,
    );
    expect(params).toEqual(['t1', 'order', 'orderId', ['a', 'b']]);
  });

  it('compiles a plain field filter onto the next param index', () => {
    const f: QueryFilter = { field: 'status', operator: 'eq', value: 'open' };
    const { where, params } = new ScopedWhere(scope).filters([f], view(), 'order').build();
    expect(where).toContain(`properties->>'status' = $3`);
    expect(params).toEqual(['t1', 'order', 'open']);
  });

  it('numeric fields cast to ::numeric', () => {
    const f: QueryFilter = { field: 'amount', operator: 'gte', value: 100 };
    const { where } = new ScopedWhere(scope).filters([f], view(), 'order').build();
    expect(where).toContain(`(properties->>'amount')::numeric >= $3`);
  });

  it('eq against null compiles to IS NULL on raw jsonb text (bug #34)', () => {
    const f: QueryFilter = { field: 'amount', operator: 'eq', value: null };
    const { where, params } = new ScopedWhere(scope).filters([f], view(), 'order').build();
    expect(where).toContain(`properties->>'amount' IS NULL`);
    expect(params).toEqual(['t1', 'order']); // no value param pushed
  });

  it('contains escapes %/_ and emits ILIKE (bug #35)', () => {
    const f: QueryFilter = { field: 'status', operator: 'contains', value: '50%_x' };
    const { where, params } = new ScopedWhere(scope).filters([f], view(), 'order').build();
    expect(where).toContain(`properties->>'status' ILIKE $3`);
    expect(params[2]).toBe('%50\\%\\_x%');
  });

  it('rejects a non-filterable field', () => {
    const f: QueryFilter = { field: 'secret', operator: 'eq', value: 1 };
    expect(() => new ScopedWhere(scope).filters([f], view(), 'order').build()).toThrow(BadRequestException);
    try {
      new ScopedWhere(scope).filters([f], view(), 'order').build();
    } catch (e) {
      expect((e as BadRequestException).getResponse()).toMatchObject({ code: 'PROPERTY_NOT_FILTERABLE' });
    }
  });

  it('remaps permission predicate $N to the running offset and records the audit string', () => {
    const predicate: Predicate = {
      ast: parse(`status = :s`),
      view: view(),
      params: { s: 'open' },
    };
    const { where, params, effectivePermissionFilter } = new ScopedWhere(scope)
      .predicates([predicate])
      .build();
    // predicate's own :s param must land at $3, after the scope's $1,$2
    expect(where).toContain(`(properties->>'status') = $3`);
    expect(params).toEqual(['t1', 'order', 'open']);
    expect(effectivePermissionFilter).toContain('"params":{"s":"open"}');
  });

  it('chains search + filters + predicates with one coherent param sequence', () => {
    const f: QueryFilter = { field: 'amount', operator: 'gt', value: 10 };
    const predicate: Predicate = {
      ast: parse(`status = :s`),
      view: view(),
      params: { s: 'open' },
    };
    const { params } = new ScopedWhere(scope)
      .search('foo')
      .filters([f], view(), 'order')
      .predicates([predicate])
      .build();
    // scope(t1,order) → search(%foo%) → filter(10) → predicate(open)
    expect(params).toEqual(['t1', 'order', '%foo%', 10, 'open']);
  });
});

// ADR-0043 §3: price-band attribution is a query-time interval predicate over the continuous
// avgPrice field — models are never pre-bucketed into a band label at ingest.
describe('model_metric price-band interval attribution (ADR-0043 §3)', () => {
  const modelScope = parentScope({ tenantId: 't1', objectType: 'model_metric' });

  const modelView = (): OntologyView => ({
    tenantId: 't1',
    objectType: 'model_metric',
    numericFields: new Set(['avgPrice', 'valueShare', 'volumeShare']),
    booleanFields: new Set(),
    stringFields: new Set(['category', 'brand', 'model', 'heating', 'launchDate', 'month', 'reservation', 'sourceReport']),
    filterableFields: new Set(['category', 'brand', 'model', 'heating', 'launchDate', 'month', 'avgPrice', 'valueShare', 'volumeShare']),
    sortableFields: new Set(['avgPrice', 'valueShare', 'volumeShare', 'month']),
    relations: {},
    derivedProperties: new Map(),
  });

  it('compiles parsePriceBand({min,max}) into a ::numeric range predicate — no label stored', () => {
    // parsePriceBand('400-500') → {min:400, max:500}; band membership is [min, max]
    const filters: QueryFilter[] = [
      { field: 'avgPrice', operator: 'gte', value: 400 },
      { field: 'avgPrice', operator: 'lte', value: 500 },
    ];
    const { where, params } = new ScopedWhere(modelScope)
      .filters(filters, modelView(), 'model_metric')
      .build();
    expect(where).toContain(`(properties->>'avgPrice')::numeric >= $3`);
    expect(where).toContain(`(properties->>'avgPrice')::numeric <= $4`);
    expect(params).toEqual(['t1', 'model_metric', 400, 500]);
  });

  it('open-ended band (≥2000, max=null) compiles to a single gte predicate', () => {
    const filters: QueryFilter[] = [
      { field: 'avgPrice', operator: 'gte', value: 2000 },
    ];
    const { where, params } = new ScopedWhere(modelScope)
      .filters(filters, modelView(), 'model_metric')
      .build();
    expect(where).toContain(`(properties->>'avgPrice')::numeric >= $3`);
    expect(params).toContain(2000);
  });

  it('model_metric view has no priceBand field — avgPrice is the continuous value (not pre-bucketed)', () => {
    expect(modelView().filterableFields.has('priceBand')).toBe(false);
    expect(modelView().numericFields.has('avgPrice')).toBe(true);
  });
});
