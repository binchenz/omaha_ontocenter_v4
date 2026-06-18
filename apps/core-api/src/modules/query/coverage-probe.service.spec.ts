import { CoverageProbe, classifyDense } from './coverage-probe.service';

/**
 * ADR-0064 §3: CoverageProbe answers "what periods actually exist for THIS star
 * under THESE filters" by live-querying the data — never by inference. The
 * load-bearing regression: a market_metric probe returns its dense monthly set
 * INDEPENDENT of brand_share's sparse snapshots (the cross-star reverse-inference
 * that caused BUG-2). Behavioral tests over a narrow interface, with prisma +
 * viewLoader injected as fixtures (the additivity/enforcer spec idiom).
 */

/** A continuous 53-month run 21.12 → 26.04 (the real market_metric coverage). */
function continuousMonths(): string[] {
  const out: string[] = [];
  for (let y = 21; y <= 26; y++) {
    const start = y === 21 ? 12 : 1;
    const end = y === 26 ? 4 : 12;
    for (let m = start; m <= end; m++) out.push(`${y}.${String(m).padStart(2, '0')}`);
  }
  return out; // sorted ascending, contiguous
}

function makeProbe(opts: {
  timeAxis?: { field: string; grain: 'month' | 'snapshot'; density: 'dense' | 'sparse' };
  rows: string[];
}): { probe: CoverageProbe; queryRawUnsafe: jest.Mock } {
  const queryRawUnsafe = jest.fn().mockResolvedValue(opts.rows.map((val) => ({ val })));
  const prisma = { $queryRawUnsafe: queryRawUnsafe } as any;
  const viewLoader = {
    load: jest.fn().mockResolvedValue(opts.timeAxis ? { timeAxis: opts.timeAxis } : {}),
  } as any;
  return { probe: new CoverageProbe(prisma, viewLoader), queryRawUnsafe };
}

describe('CoverageProbe — coverage()', () => {
  it('returns the dense monthly set for market_metric, with the timeAxis field + extremes', async () => {
    const months = continuousMonths();
    const { probe } = makeProbe({ timeAxis: { field: 'month', grain: 'month', density: 'dense' }, rows: months });
    const cov = await probe.coverage('t1', 'market_metric', [
      { field: 'category', operator: 'eq', value: '电饭煲' },
      { field: 'metric', operator: 'eq', value: '零售额' },
    ]);
    expect(cov.field).toBe('month');
    expect(cov.values).toHaveLength(53);
    expect(cov.min).toBe('21.12');
    expect(cov.max).toBe('26.04');
    expect(cov.isDense).toBe(true);
    // The months the UAT Agent falsely called "无数据" are all present.
    for (const m of ['25.07', '25.08', '25.09', '25.10', '25.11']) {
      expect(cov.values).toContain(m);
    }
  });

  it('REGRESSION: a market_metric probe is unaffected by brand_share\'s sparse snapshots', async () => {
    // market_metric probe returns the dense set; brand_share probe returns 5 sparse
    // points. The two are independent — one never stands in for the other (BUG-2 root).
    const market = makeProbe({ timeAxis: { field: 'month', grain: 'month', density: 'dense' }, rows: continuousMonths() });
    const brand = makeProbe({
      timeAxis: { field: 'period', grain: 'snapshot', density: 'sparse' },
      rows: ['22.12', '23.12', '24.12', '25.12', '26.04'],
    });
    const marketCov = await market.probe.coverage('t1', 'market_metric', [{ field: 'category', operator: 'eq', value: '电饭煲' }]);
    const brandCov = await brand.probe.coverage('t1', 'brand_share', [{ field: 'category', operator: 'eq', value: '电饭煲' }]);

    expect(marketCov.values).toHaveLength(53);
    expect(marketCov.isDense).toBe(true);
    expect(brandCov.values).toHaveLength(5);
    expect(brandCov.field).toBe('period');
    // brand_share's 5 sparse periods must NOT cap market_metric's 53-month coverage.
    expect(marketCov.values.length).toBeGreaterThan(brandCov.values.length);
    expect(brandCov.isDense).toBe(false); // a snapshot star is never a continuous series
  });

  it('flags a real gap in a dense series as not-dense', async () => {
    // 25.07–25.11 genuinely missing from an otherwise-monthly series.
    const withGap = continuousMonths().filter((m) => !['25.07', '25.08', '25.09', '25.10', '25.11'].includes(m));
    const { probe } = makeProbe({ timeAxis: { field: 'month', grain: 'month', density: 'dense' }, rows: withGap });
    const cov = await probe.coverage('t1', 'market_metric', []);
    expect(cov.isDense).toBe(false);
    expect(cov.values).not.toContain('25.07');
  });

  it('scopes the probe by eq/in filters and never constrains the axis field itself', async () => {
    const { probe, queryRawUnsafe } = makeProbe({ timeAxis: { field: 'month', grain: 'month', density: 'dense' }, rows: ['26.04'] });
    await probe.coverage('t1', 'market_metric', [
      { field: 'category', operator: 'eq', value: '电饭煲' },
      { field: 'brand', operator: 'in', value: ['小米', '米家'] },
      { field: 'month', operator: 'eq', value: 'IGNORED' }, // self-filter must be skipped
    ]);
    const [sql, ...params] = queryRawUnsafe.mock.calls[0];
    expect(sql).toContain("properties->>'month'"); // enumerates the axis
    expect(params).toContain('电饭煲');
    expect(params).toContain('小米');
    expect(params).toContain('米家');
    expect(params).not.toContain('IGNORED'); // the month self-filter was dropped
  });

  it('emits FALSE (not invalid IN ()) for an empty in-filter, yielding empty coverage', async () => {
    const { probe, queryRawUnsafe } = makeProbe({ timeAxis: { field: 'month', grain: 'month', density: 'dense' }, rows: [] });
    await probe.coverage('t1', 'market_metric', [{ field: 'brand', operator: 'in', value: [] }]);
    const [sql] = queryRawUnsafe.mock.calls[0];
    expect(sql).toContain('FALSE');
    expect(sql).not.toMatch(/IN \(\s*\)/); // never the syntax-error form
  });

  it('returns an honest empty result when the star declares no time axis', async () => {
    const { probe, queryRawUnsafe } = makeProbe({ rows: [] });
    const cov = await probe.coverage('t1', 'plain_type', []);
    expect(cov).toEqual({ field: '', values: [], min: null, max: null, isDense: false });
    expect(queryRawUnsafe).not.toHaveBeenCalled(); // never guesses a field to probe
  });

  it('probes a caller-supplied fieldOverride when no timeAxis is declared', async () => {
    const { probe } = makeProbe({ rows: ['22.12', '23.12'] });
    const cov = await probe.coverage('t1', 'avc_report', [], 'period');
    expect(cov.field).toBe('period');
    expect(cov.values).toEqual(['22.12', '23.12']);
  });
});

describe('classifyDense (pure)', () => {
  it('a sparse star is never dense', () => {
    expect(classifyDense(['22.12', '23.12', '24.12'], false, 'snapshot')).toBe(false);
  });

  it('a contiguous monthly run is dense', () => {
    expect(classifyDense(['25.01', '25.02', '25.03'], true, 'month')).toBe(true);
  });

  it('a monthly run with a hole is not dense', () => {
    expect(classifyDense(['25.01', '25.03'], true, 'month')).toBe(false);
  });

  it('a run crossing a year boundary stays dense', () => {
    expect(classifyDense(['25.11', '25.12', '26.01'], true, 'month')).toBe(true);
  });

  it('0 or 1 point cannot have an internal gap', () => {
    expect(classifyDense([], true, 'month')).toBe(true);
    expect(classifyDense(['26.04'], true, 'month')).toBe(true);
  });

  it('falls back to declared intent for an unparseable / non-month grain', () => {
    expect(classifyDense(['Q1', 'Q2'], true, 'quarter')).toBe(true);
    expect(classifyDense(['weird', 'values'], true, 'month')).toBe(true); // unparseable → trust intent
  });
});
