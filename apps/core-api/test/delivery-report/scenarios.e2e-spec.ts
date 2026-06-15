import { buildScenarios } from './scenarios';
import type { Anchors } from './anchors';

/**
 * Scenarios — the declarative catalog of 纯米 business questions. These unit-level tests use a
 * synthetic Anchors fixture (no DB) to prove templates instantiate into concrete questions with
 * no leftover placeholders, all 6 business categories are present, and each carries 3–5 examples.
 * The judge closures (truth/behavior) are exercised in the orchestration e2e against real data.
 */
const ANCHORS: Anchors = {
  tenantId: 'fake-tenant',
  categories: [
    {
      name: '电饭煲',
      latestMarketMonth: '22.12',
      latestBrandPeriod: '22.12',
      allBrandPeriods: ['22.12', '23.12', '24.12', '25.12', '26.04'],
      latestModelMonth: '22.12',
      priceBands: ['≥300', '200-300', '0-80'],
      topBrands: ['美的', '苏泊尔', '小熊', '九阳', '小米'],
    },
    {
      name: '空气炸锅',
      latestMarketMonth: '22.12',
      latestBrandPeriod: '22.12',
      allBrandPeriods: ['22.12', '23.12'],
      latestModelMonth: '22.12',
      priceBands: ['200-300'],
      topBrands: ['美的'],
    },
  ],
  absentBrand: '纯米',
};

describe('scenarios — catalog instantiation from anchors', () => {
  const scenarios = buildScenarios(ANCHORS);

  it('produces scenarios across all 7 business categories', () => {
    const cats = new Set(scenarios.map((s) => s.category));
    expect(cats).toEqual(
      new Set(['市场大盘体检', '品牌竞争格局', '纯米自家定位', '价格段攻防', '机型级洞察', '知识边界诚实', '趋势分析']),
    );
  });

  it('each category carries 3–5 examples', () => {
    const byCat = new Map<string, number>();
    for (const s of scenarios) byCat.set(s.category, (byCat.get(s.category) ?? 0) + 1);
    for (const [, n] of byCat) {
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
    }
  });

  it('every question is fully instantiated (no leftover {placeholders})', () => {
    for (const s of scenarios) {
      expect(s.question.length).toBeGreaterThan(0);
      expect(s.question).not.toMatch(/\{[a-zA-Z]/); // no {category} {month} etc. left
    }
  });

  it('every scenario declares a difficulty label and a judge track', () => {
    for (const s of scenarios) {
      expect(s.difficulty).toMatch(/^L[1-5]$/);
      expect(['fact', 'behavior']).toContain(s.track);
      expect(typeof s.id).toBe('string');
    }
  });

  it('fact-track scenarios target a concrete objectType for the truth comparison', () => {
    const factScenarios = scenarios.filter((s) => s.track === 'fact');
    expect(factScenarios.length).toBeGreaterThan(0);
    for (const s of factScenarios) {
      expect(s.expectObjectType).toBeTruthy();
    }
  });
});
