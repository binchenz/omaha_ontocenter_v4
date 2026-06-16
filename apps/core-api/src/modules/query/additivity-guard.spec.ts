import { planMetricAdditivity, AdditivityMap } from './additivity-guard';

/** Build an additivity map quickly from a plain object. */
function mapOf(entries: AdditivityMap extends Map<string, infer V> ? Record<string, V> : never): AdditivityMap {
  return new Map(Object.entries(entries));
}

// A view-field numeric predicate; by default every referenced field is numeric.
const allNumeric = () => true;

describe('AdditivityGuard — planMetricAdditivity', () => {
  describe('untagged / additive', () => {
    it('passes when no additivity map is provided', () => {
      const d = planMetricAdditivity({ kind: 'sum', field: 'value', alias: 'v' }, undefined, allNumeric);
      expect(d).toEqual({ action: 'pass' });
    });

    it('passes when the field is not in the additivity map', () => {
      const d = planMetricAdditivity({ kind: 'sum', field: 'other', alias: 'v' }, mapOf({ value: { kind: 'additive' } }), allNumeric);
      expect(d).toEqual({ action: 'pass' });
    });

    it('passes an additive field for sum', () => {
      const d = planMetricAdditivity({ kind: 'sum', field: 'value', alias: 'v' }, mapOf({ value: { kind: 'additive' } }), allNumeric);
      expect(d).toEqual({ action: 'pass' });
    });

    it('passes an additive field for avg', () => {
      const d = planMetricAdditivity({ kind: 'avg', field: 'value', alias: 'v' }, mapOf({ value: { kind: 'additive' } }), allNumeric);
      expect(d).toEqual({ action: 'pass' });
    });

    it('passes a count metric (no field) regardless of map', () => {
      const d = planMetricAdditivity({ kind: 'count', alias: 'c' }, mapOf({ value: { kind: 'non-additive' } }), allNumeric);
      expect(d).toEqual({ action: 'pass' });
    });
  });

  describe('non-additive (shares)', () => {
    it('errors on sum with a NON_ADDITIVE_SUM code and a hint', () => {
      const d = planMetricAdditivity({ kind: 'sum', field: 'share', alias: 's' }, mapOf({ share: { kind: 'non-additive' } }), allNumeric);
      expect(d.action).toBe('error');
      if (d.action !== 'error') throw new Error('unreachable');
      expect(d.code).toBe('NON_ADDITIVE_SUM');
      expect(d.field).toBe('share');
      expect(d.kind).toBe('sum');
      expect(d.hint).toMatch(/份额|share|不可加|sum/i);
    });

    it('passes min/max on a non-additive field', () => {
      expect(planMetricAdditivity({ kind: 'max', field: 'share', alias: 's' }, mapOf({ share: { kind: 'non-additive' } }), allNumeric)).toEqual({ action: 'pass' });
      expect(planMetricAdditivity({ kind: 'min', field: 'share', alias: 's' }, mapOf({ share: { kind: 'non-additive' } }), allNumeric)).toEqual({ action: 'pass' });
    });

    it('passes countDistinct on a non-additive field', () => {
      expect(planMetricAdditivity({ kind: 'countDistinct', field: 'share', alias: 's' }, mapOf({ share: { kind: 'non-additive' } }), allNumeric)).toEqual({ action: 'pass' });
    });
  });

  describe('ratio with resolvable sibling columns → weighted rewrite', () => {
    const ratioMap = mapOf({ avgPrice: { kind: 'ratio', ratioOf: { numerator: 'amount', denominator: 'qty' } } });

    it('rewrites avg to a weighted division over the sibling columns', () => {
      const d = planMetricAdditivity({ kind: 'avg', field: 'avgPrice', alias: 'p' }, ratioMap, allNumeric);
      expect(d).toEqual({ action: 'rewrite-weighted', numerator: 'amount', denominator: 'qty' });
    });

    it('passes min/max on a ratio field unchanged', () => {
      expect(planMetricAdditivity({ kind: 'max', field: 'avgPrice', alias: 'p' }, ratioMap, allNumeric)).toEqual({ action: 'pass' });
      expect(planMetricAdditivity({ kind: 'min', field: 'avgPrice', alias: 'p' }, ratioMap, allNumeric)).toEqual({ action: 'pass' });
    });

    it('errors on sum of a ratio field', () => {
      const d = planMetricAdditivity({ kind: 'sum', field: 'avgPrice', alias: 'p' }, ratioMap, allNumeric);
      expect(d.action).toBe('error');
      if (d.action !== 'error') throw new Error('unreachable');
      expect(d.code).toBe('RATIO_SUM');
    });
  });

  describe('ratio without resolvable sibling columns → structured error (AVC long-format reality)', () => {
    it('errors on avg when ratioOf is absent (e.g. model_metric.avgPrice)', () => {
      const d = planMetricAdditivity({ kind: 'avg', field: 'avgPrice', alias: 'p' }, mapOf({ avgPrice: { kind: 'ratio' } }), allNumeric);
      expect(d.action).toBe('error');
      if (d.action !== 'error') throw new Error('unreachable');
      expect(d.code).toBe('RATIO_AVG_UNWEIGHTABLE');
      expect(d.hint).toMatch(/加权|weight|均价|ratio/i);
    });

    it('errors on avg when a ratioOf column is not numeric on the view', () => {
      const ratioMap = mapOf({ avgPrice: { kind: 'ratio', ratioOf: { numerator: 'amount', denominator: 'qty' } } });
      const onlyAmountNumeric = (f: string) => f === 'amount'; // qty missing/non-numeric
      const d = planMetricAdditivity({ kind: 'avg', field: 'avgPrice', alias: 'p' }, ratioMap, onlyAmountNumeric);
      expect(d.action).toBe('error');
      if (d.action !== 'error') throw new Error('unreachable');
      expect(d.code).toBe('RATIO_AVG_UNWEIGHTABLE');
    });
  });
});
