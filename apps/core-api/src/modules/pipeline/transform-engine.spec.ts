import { TransformEngine, TransformStepError } from './transform-engine';

/**
 * TransformEngine black-box spec (ADR-0060 #1). Exercises the public `run(inputs, steps)`
 * interface only — never DuckDB internals — so the in-memory→DuckDB engine swap is invisible
 * to these tests. Each test asserts output rows for given (inputs, steps), which is the engine's
 * whole contract. Prior art for the behaviors covered: pipeline-run.worker.spec.ts.
 */
describe('TransformEngine', () => {
  let engine: TransformEngine;
  beforeEach(() => {
    engine = new TransformEngine();
  });

  const single = (rows: Array<Record<string, unknown>>) => [{ name: 'input', rows }];

  it('returns an empty result for empty input without error', async () => {
    const out = await engine.run(single([]), [
      { order: 1, type: 'filter', config: { field: 'status', operator: 'eq', value: 'active' } },
    ]);
    expect(out).toEqual([]);
  });

  it('passes rows through unchanged when there are no steps', async () => {
    const out = await engine.run(single([{ a: 1 }, { a: 2 }]), []);
    expect(out).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('throws a structured error for an unknown step type', async () => {
    const err = await engine.run(single([{ a: 1 }]), [{ order: 3, type: 'wat', config: {} }]).catch((e) => e);
    expect(err).toBeInstanceOf(TransformStepError);
    expect(err.stepOrder).toBe(3);
    expect(err.message).toMatch(/unknown step type/i);
  });

  it('filters rows by an eq operator, preserving row order', async () => {
    const out = await engine.run(
      single([
        { status: 'active', name: 'Alice' },
        { status: 'inactive', name: 'Bob' },
        { status: 'active', name: 'Charlie' },
      ]),
      [{ order: 1, type: 'filter', config: { field: 'status', operator: 'eq', value: 'active' } }],
    );
    expect(out).toEqual([
      { status: 'active', name: 'Alice' },
      { status: 'active', name: 'Charlie' },
    ]);
  });

  it('supports gt/lt/gte/lte numeric operators', async () => {
    const rows = [{ n: 5 }, { n: 10 }, { n: 15 }, { n: 20 }];
    const filtered = async (operator: string, value: number) =>
      (await engine.run(single(rows), [{ order: 1, type: 'filter', config: { field: 'n', operator, value } }])).map((r) => r.n);
    expect(await filtered('gt', 10)).toEqual([15, 20]);
    expect(await filtered('gte', 10)).toEqual([10, 15, 20]);
    expect(await filtered('lt', 15)).toEqual([5, 10]);
    expect(await filtered('lte', 15)).toEqual([5, 10, 15]);
  });

  it('supports the contains operator (substring match)', async () => {
    const out = await engine.run(
      single([{ s: 'apple' }, { s: 'banana' }, { s: 'grape' }]),
      [{ order: 1, type: 'filter', config: { field: 's', operator: 'contains', value: 'ap' } }],
    );
    expect(out.map((r) => r.s)).toEqual(['apple', 'grape']);
  });

  it('supports the in operator (membership in a list)', async () => {
    const out = await engine.run(
      single([{ c: '电饭煲' }, { c: '净水器' }, { c: '空气炸锅' }]),
      [{ order: 1, type: 'filter', config: { field: 'c', operator: 'in', value: ['电饭煲', '空气炸锅'] } }],
    );
    expect(out.map((r) => r.c)).toEqual(['电饭煲', '空气炸锅']);
  });

  it('renames mapped keys while passing untouched keys and value types through', async () => {
    const out = await engine.run(
      single([{ old_name: 'Alice', status: 'active', n: 1, nested: { a: 1 }, keep: true }]),
      [{ order: 1, type: 'rename', config: { mappings: { old_name: 'new_name', status: 'state' } } }],
    );
    expect(out).toEqual([
      { new_name: 'Alice', state: 'active', n: 1, nested: { a: 1 }, keep: true },
    ]);
  });

  it('chains filter then rename, consuming the prior step output', async () => {
    const out = await engine.run(
      single([
        { status: 'active', old_name: 'Alice' },
        { status: 'inactive', old_name: 'Bob' },
        { status: 'active', old_name: 'Charlie' },
      ]),
      [
        { order: 1, type: 'filter', config: { field: 'status', operator: 'eq', value: 'active' } },
        { order: 2, type: 'rename', config: { mappings: { old_name: 'name' } } },
      ],
    );
    expect(out).toEqual([
      { status: 'active', name: 'Alice' },
      { status: 'active', name: 'Charlie' },
    ]);
  });

  // compute reads its already-resolved mappings/bands from step config; the caller (worker) is
  // responsible for version-pinned TransformConfig resolution (ADR-0054) before invoking the engine.
  describe('join (fact × fact, multi-input)', () => {
    const orders = [
      { orderId: 'o1', amount: 100 },
      { orderId: 'o2', amount: 50 },
      { orderId: 'o3', amount: 30 },
    ];
    const refunds = [
      { orderId: 'o1', refund: 20 },
      { orderId: 'o2', refund: 5 },
    ];

    it('inner-joins two named inputs on a key, merging right columns onto left', async () => {
      const out = await engine.run(
        [
          { name: 'orders', rows: orders },
          { name: 'refunds', rows: refunds },
        ],
        [{ order: 1, type: 'join', config: {
          left: 'orders', right: 'refunds', type: 'inner',
          on: [{ leftField: 'orderId', rightField: 'orderId' }],
        } }],
      );
      expect(out).toEqual([
        { orderId: 'o1', amount: 100, refund: 20 },
        { orderId: 'o2', amount: 50, refund: 5 },
      ]);
    });

    it('left-joins keeping unmatched left rows', async () => {
      const out = await engine.run(
        [
          { name: 'orders', rows: orders },
          { name: 'refunds', rows: refunds },
        ],
        [{ order: 1, type: 'join', config: {
          left: 'orders', right: 'refunds', type: 'left',
          on: [{ leftField: 'orderId', rightField: 'orderId' }],
        } }],
      );
      expect(out).toEqual([
        { orderId: 'o1', amount: 100, refund: 20 },
        { orderId: 'o2', amount: 50, refund: 5 },
        { orderId: 'o3', amount: 30 },
      ]);
    });

    it('supports a composite join key', async () => {
      const out = await engine.run(
        [
          { name: 'a', rows: [{ region: 'N', cat: 'X', v: 1 }, { region: 'S', cat: 'X', v: 2 }] },
          { name: 'b', rows: [{ region: 'N', cat: 'X', w: 9 }] },
        ],
        [{ order: 1, type: 'join', config: {
          left: 'a', right: 'b', type: 'inner',
          on: [{ leftField: 'region', rightField: 'region' }, { leftField: 'cat', rightField: 'cat' }],
        } }],
      );
      expect(out).toEqual([{ region: 'N', cat: 'X', v: 1, w: 9 }]);
    });

    it('can be followed by a downstream single-input step (join then compute)', async () => {
      const out = await engine.run(
        [
          { name: 'orders', rows: orders },
          { name: 'refunds', rows: refunds },
        ],
        [
          { order: 1, type: 'join', config: {
            left: 'orders', right: 'refunds', type: 'inner',
            on: [{ leftField: 'orderId', rightField: 'orderId' }],
          } },
          { order: 2, type: 'rename', config: { mappings: { refund: 'refund_amount' } } },
        ],
      );
      expect(out).toEqual([
        { orderId: 'o1', amount: 100, refund_amount: 20 },
        { orderId: 'o2', amount: 50, refund_amount: 5 },
      ]);
    });
  });

  describe('compute: normalize_brand', () => {
    it('maps known values case-insensitively and passes unknowns through', async () => {
      const out = await engine.run(
        single([{ brand: 'hw' }, { brand: 'HW' }, { brand: 'unknown-co' }]),
        [{ order: 1, type: 'compute', config: {
          function: 'normalize_brand', inputField: 'brand', outputField: 'brand_norm',
          mappings: { hw: 'Huawei' },
        } }],
      );
      expect(out.map((r) => r.brand_norm)).toEqual(['Huawei', 'Huawei', 'unknown-co']);
    });

    it('honors caseSensitive=true (exact-case match only)', async () => {
      const out = await engine.run(
        single([{ brand: 'hw' }, { brand: 'HW' }]),
        [{ order: 1, type: 'compute', config: {
          function: 'normalize_brand', inputField: 'brand', outputField: 'brand_norm',
          mappings: { hw: 'Huawei' }, caseSensitive: true,
        } }],
      );
      expect(out.map((r) => r.brand_norm)).toEqual(['Huawei', 'HW']);
    });

    it('writes the normalized value in place when outputField equals inputField', async () => {
      const out = await engine.run(
        single([{ brand: 'hw' }]),
        [{ order: 1, type: 'compute', config: {
          function: 'normalize_brand', inputField: 'brand', outputField: 'brand',
          mappings: { hw: 'Huawei' },
        } }],
      );
      expect(out).toEqual([{ brand: 'Huawei' }]);
    });
  });

  describe('compute: concat (#177 — rebuild a derived key after normalization)', () => {
    it('joins the named fields with the separator into outputField', async () => {
      const out = await engine.run(
        single([{ category: '电饭煲', brand: '苏泊尔', priceBand: '整体', period: '26.04' }]),
        [{ order: 1, type: 'compute', config: {
          function: 'concat', fields: ['category', 'brand', 'priceBand', 'period'], separator: '_', outputField: 'externalId',
        } }],
      );
      expect(out[0].externalId).toBe('电饭煲_苏泊尔_整体_26.04');
    });

    it('uses the post-normalization brand so dirty variants converge to one key', async () => {
      const out = await engine.run(
        single([
          { category: '台式复合机', brand: '苏泊', priceBand: '整体', period: '26.04', value: 3 },
          { category: '台式复合机', brand: '苏泊尔', priceBand: '整体', period: '26.04', value: 5 },
        ]),
        [
          { order: 1, type: 'compute', config: { function: 'normalize_brand', inputField: 'brand', outputField: 'brand', mappings: { 苏泊: '苏泊尔' } } },
          { order: 2, type: 'compute', config: { function: 'concat', fields: ['category', 'brand', 'priceBand', 'period'], separator: '_', outputField: 'externalId' } },
        ],
      );
      // Both rows now carry the SAME regenerated externalId (built from normalized brand).
      expect(out.map((r) => r.externalId)).toEqual(['台式复合机_苏泊尔_整体_26.04', '台式复合机_苏泊尔_整体_26.04']);
    });

    it('treats a missing field as empty in the key', async () => {
      const out = await engine.run(
        single([{ a: 'x' }]),
        [{ order: 1, type: 'compute', config: { function: 'concat', fields: ['a', 'b'], separator: '_', outputField: 'k' } }],
      );
      expect(out[0].k).toBe('x_');
    });
  });

  describe('brand-merge round-trip (#177 — normalize → re-key → merge-sum)', () => {
    it('merges colliding brand_share variants summing the share value', async () => {
      const out = await engine.run(
        single([
          { category: '台式复合机', brand: '苏泊', priceBand: '整体', period: '26.04', metric: 'share', sourceReport: 'r1', value: 3 },
          { category: '台式复合机', brand: '苏泊尔', priceBand: '整体', period: '26.04', metric: 'share', sourceReport: 'r1', value: 5 },
          { category: '台式复合机', brand: '美的', priceBand: '整体', period: '26.04', metric: 'share', sourceReport: 'r1', value: 7 },
        ]),
        [
          { order: 1, type: 'compute', config: { function: 'normalize_brand', inputField: 'brand', outputField: 'brand', mappings: { 苏泊: '苏泊尔' } } },
          { order: 2, type: 'compute', config: { function: 'concat', fields: ['category', 'brand', 'priceBand', 'period'], separator: '_', outputField: 'externalId' } },
          { order: 3, type: 'aggregate', config: {
            groupBy: ['externalId', 'category', 'brand', 'priceBand', 'period', 'metric', 'sourceReport'],
            metrics: [{ op: 'sum', field: 'value', as: 'value' }],
          } },
        ],
      );
      // 苏泊 (3) + 苏泊尔 (5) merge into one 苏泊尔 row valued 8; 美的 untouched.
      const sup = out.find((r) => r.brand === '苏泊尔');
      const mid = out.find((r) => r.brand === '美的');
      expect(out).toHaveLength(2);
      expect(sup!.value).toBe(8);
      expect(sup!.externalId).toBe('台式复合机_苏泊尔_整体_26.04');
      expect(mid!.value).toBe(7);
    });
  });

  describe('explode_json', () => {
    it('array mode: emits one row per array element, merged with the parent (minus the field)', async () => {
      const out = await engine.run(
        single([
          { deviceId: 'd1', events: [{ k: 'a' }, { k: 'b' }] },
          { deviceId: 'd2', events: [{ k: 'c' }] },
        ]),
        [{ order: 1, type: 'explode_json', config: { field: 'events', mode: 'array' } }],
      );
      expect(out).toEqual([
        { deviceId: 'd1', k: 'a' },
        { deviceId: 'd1', k: 'b' },
        { deviceId: 'd2', k: 'c' },
      ]);
    });

    it('object mode: spreads a nested JSON object field to top-level columns', async () => {
      const out = await engine.run(
        single([
          { deviceId: 'd1', payload: { temp: 20, hum: 50 } },
          { deviceId: 'd2', payload: { temp: 5 } },
        ]),
        [{ order: 1, type: 'explode_json', config: { field: 'payload', mode: 'object' } }],
      );
      expect(out).toEqual([
        { deviceId: 'd1', temp: 20, hum: 50 },
        { deviceId: 'd2', temp: 5 },
      ]);
    });
  });

  describe('dedup', () => {
    it('collapses duplicate rows by a single key, keeping the first occurrence', async () => {
      const out = await engine.run(
        single([
          { a: 1, b: 'x' },
          { a: 1, b: 'y' },
          { a: 2, b: 'z' },
        ]),
        [{ order: 1, type: 'dedup', config: { keys: ['a'] } }],
      );
      expect(out).toEqual([
        { a: 1, b: 'x' },
        { a: 2, b: 'z' },
      ]);
    });

    it('dedups on a composite key set', async () => {
      const out = await engine.run(
        single([
          { a: 1, b: 'x', c: 1 },
          { a: 1, b: 'x', c: 2 },
          { a: 1, b: 'y', c: 3 },
        ]),
        [{ order: 1, type: 'dedup', config: { keys: ['a', 'b'] } }],
      );
      expect(out).toEqual([
        { a: 1, b: 'x', c: 1 },
        { a: 1, b: 'y', c: 3 },
      ]);
    });
  });

  describe('aggregate', () => {
    it('groups by a key and computes sum + count metrics', async () => {
      const out = await engine.run(
        single([
          { cat: 'A', v: 10 },
          { cat: 'A', v: 20 },
          { cat: 'B', v: 5 },
        ]),
        [{ order: 1, type: 'aggregate', config: {
          groupBy: ['cat'],
          metrics: [
            { op: 'sum', field: 'v', as: 'total' },
            { op: 'count', as: 'n' },
          ],
        } }],
      );
      expect(out).toEqual([
        { cat: 'A', total: 30, n: 2 },
        { cat: 'B', total: 5, n: 1 },
      ]);
    });

    it('supports avg/min/max metrics', async () => {
      const out = await engine.run(
        single([
          { g: 'x', v: 2 },
          { g: 'x', v: 8 },
        ]),
        [{ order: 1, type: 'aggregate', config: {
          groupBy: ['g'],
          metrics: [
            { op: 'avg', field: 'v', as: 'mean' },
            { op: 'min', field: 'v', as: 'lo' },
            { op: 'max', field: 'v', as: 'hi' },
          ],
        } }],
      );
      expect(out).toEqual([{ g: 'x', mean: 5, lo: 2, hi: 8 }]);
    });

    it('groups by a composite key', async () => {
      const out = await engine.run(
        single([
          { region: 'N', cat: 'A', v: 1 },
          { region: 'N', cat: 'A', v: 2 },
          { region: 'S', cat: 'A', v: 4 },
        ]),
        [{ order: 1, type: 'aggregate', config: {
          groupBy: ['region', 'cat'],
          metrics: [{ op: 'sum', field: 'v', as: 'total' }],
        } }],
      );
      expect(out).toEqual([
        { region: 'N', cat: 'A', total: 3 },
        { region: 'S', cat: 'A', total: 4 },
      ]);
    });
  });

  describe('compute: price_band', () => {
    const bandStep = { order: 1, type: 'compute', config: {
      function: 'price_band', inputField: 'price', outputField: 'band',
      bands: [{ max: 200, label: 'low' }, { max: 500, label: 'mid' }, { label: 'high' }],
    } };

    it('bins values into bands including the open-ended top band', async () => {
      const out = await engine.run(single([{ price: 150 }, { price: 250 }, { price: 9000 }]), [bandStep]);
      expect(out.map((r) => r.band)).toEqual(['low', 'mid', 'high']);
    });

    it('uses <= boundary semantics (value equal to a band max stays in that band)', async () => {
      const out = await engine.run(single([{ price: 200 }, { price: 500 }]), [bandStep]);
      expect(out.map((r) => r.band)).toEqual(['low', 'mid']);
    });

    it('throws a structured step error (order + row index) on a non-numeric value', async () => {
      const err = await engine
        .run(single([{ price: 150 }, { price: 'abc' }]), [bandStep])
        .catch((e) => e);
      expect(err).toBeInstanceOf(TransformStepError);
      expect(err.stepOrder).toBe(1);
      expect(err.rowIndex).toBe(1);
      expect(err.message).toMatch(/price_band|numeric/i);
    });

    it('throws a structured step error when a value falls outside all bands (no open-ended band)', async () => {
      const closedBands = { order: 2, type: 'compute', config: {
        function: 'price_band', inputField: 'price', outputField: 'band',
        bands: [{ max: 200, label: 'low' }],
      } };
      const err = await engine.run(single([{ price: 150 }, { price: 9000 }]), [closedBands]).catch((e) => e);
      expect(err).toBeInstanceOf(TransformStepError);
      expect(err.stepOrder).toBe(2);
      expect(err.rowIndex).toBe(1);
    });
  });
});
