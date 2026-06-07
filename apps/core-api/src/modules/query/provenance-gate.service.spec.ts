import { ProvenanceGate, ProvenanceGateEntry, ESSENCE_COVERAGE_WARNING } from './provenance-gate.service';
import type { QueryFilter } from '@omaha/shared-types';

/**
 * The gate reads avc_report provenance rows for the scope a Query Plan declares.
 * We fake Prisma's object_instances lookup: each test seeds a few avc_report rows
 * (category, period, coverage) and asserts the verdict the gate hands back to
 * QueryService — an AVC_REPORT_NOT_FOUND error and/or a set of essence warnings.
 */
const REGISTRY: ProvenanceGateEntry[] = [
  { objectType: 'market_metric', provenanceType: 'avc_report', categoryField: 'category', periodField: 'month', modelLayer: false },
  { objectType: 'brand_share', provenanceType: 'avc_report', categoryField: 'category', periodField: 'period', modelLayer: false },
  { objectType: 'model_metric', provenanceType: 'avc_report', categoryField: 'category', periodField: 'month', modelLayer: true },
];

type Report = { category: string; period: string; coverage: 'full' | 'essence' };

function makeGate(reports: Report[]) {
  // Fake the one query the gate issues: SELECT category/period/coverage FROM
  // object_instances WHERE object_type='avc_report' AND tenant AND (category=?)(period=?).
  // We filter the seeded reports in-memory by the bound params the gate passes.
  const fakePrisma: any = {
    $queryRawUnsafe: jest.fn(async (_sql: string, ..._params: unknown[]) => {
      // The gate passes [tenantId, ...scopeValues]; we ignore SQL and filter by the
      // scope the gate computed, which it also exposes via the params tail.
      return reports.map((r) => ({ category: r.category, period: r.period, coverage: r.coverage }));
    }),
  };
  return new ProvenanceGate(fakePrisma, REGISTRY);
}

const f = (field: string, value: unknown): QueryFilter => ({ field, operator: 'eq', value });

describe('ProvenanceGate.evaluate — existence (AVC_REPORT_NOT_FOUND)', () => {
  it('is a no-op for a non-gated object type', async () => {
    const gate = makeGate([]);
    const v = await gate.evaluate('t1', 'order', [f('category', '电饭煲')]);
    expect(v).toEqual({ warnings: [] });
  });

  it('is a no-op when the query carries no category scope (unbounded scan)', async () => {
    const gate = makeGate([]);
    const v = await gate.evaluate('t1', 'model_metric', [f('avgPrice', 5000)]);
    expect(v).toEqual({ warnings: [] });
  });

  it('fails AVC_REPORT_NOT_FOUND when a category+period scope matches zero reports', async () => {
    const gate = makeGate([]); // tenant has no avc_report rows for this scope
    const v = await gate.evaluate('t1', 'model_metric', [f('category', '电饭煲'), f('month', '26.04')]);
    expect(v.error).toBe('AVC_REPORT_NOT_FOUND');
  });

  it('passes clean when a full report matches the scope', async () => {
    const gate = makeGate([{ category: '电饭煲', period: '26.04', coverage: 'full' }]);
    const v = await gate.evaluate('t1', 'model_metric', [f('category', '电饭煲'), f('month', '26.04')]);
    expect(v).toEqual({ warnings: [] });
  });
});

describe('ProvenanceGate.evaluate — essence warning + per-matched-report', () => {
  it('warns ESSENCE_COVERAGE_MODEL_UNAVAILABLE on a model-layer query over an essence period', async () => {
    const gate = makeGate([{ category: '空气炸锅', period: '26.04', coverage: 'essence' }]);
    const v = await gate.evaluate('t1', 'model_metric', [f('category', '空气炸锅'), f('month', '26.04')]);
    expect(v.error).toBeUndefined();
    expect(v.warnings).toEqual([`${ESSENCE_COVERAGE_WARNING}: 26.04`]);
  });

  it('does NOT warn for brand_share over an essence period (brand layer present in essence)', async () => {
    const gate = makeGate([{ category: '空气炸锅', period: '26.04', coverage: 'essence' }]);
    const v = await gate.evaluate('t1', 'brand_share', [f('category', '空气炸锅'), f('period', '26.04')]);
    expect(v).toEqual({ warnings: [] });
  });

  it('per-matched-report: a category-only scan names only the essence period(s), not the full ones', async () => {
    const gate = makeGate([
      { category: '空气炸锅', period: '23.12', coverage: 'full' },
      { category: '空气炸锅', period: '24.12', coverage: 'essence' },
      { category: '空气炸锅', period: '26.04', coverage: 'essence' },
    ]);
    const v = await gate.evaluate('t1', 'model_metric', [f('category', '空气炸锅')]);
    expect(v.warnings).toEqual([`${ESSENCE_COVERAGE_WARNING}: 24.12, 26.04`]);
  });

  it('passes clean on a category-only scan when every matched report is full', async () => {
    const gate = makeGate([
      { category: '电饭煲', period: '23.11', coverage: 'full' },
      { category: '电饭煲', period: '23.12', coverage: 'full' },
    ]);
    const v = await gate.evaluate('t1', 'model_metric', [f('category', '电饭煲')]);
    expect(v).toEqual({ warnings: [] });
  });

  it('binds the period filter into the provenance lookup when present (scope narrows the SQL)', async () => {
    const captured: unknown[][] = [];
    const fakePrisma: any = {
      $queryRawUnsafe: jest.fn(async (_sql: string, ...params: unknown[]) => {
        captured.push(params);
        return [{ category: '电饭煲', period: '26.04', coverage: 'full' }];
      }),
    };
    const gate = new ProvenanceGate(fakePrisma, REGISTRY);
    await gate.evaluate('t1', 'model_metric', [f('category', '电饭煲'), f('month', '26.04')]);
    expect(captured[0]).toEqual(['t1', 'avc_report', '电饭煲', '26.04']);
  });
});
