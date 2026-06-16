import { BadRequestException } from '@nestjs/common';
import { validatePipelineStep, PIPELINE_STEP_SCHEMAS } from './pipeline-step.schemas';

describe('pipeline-step schemas (ADR-0053)', () => {
  it('exposes filter/rename/compute + the ADR-0060 operators', () => {
    expect(Object.keys(PIPELINE_STEP_SCHEMAS).sort()).toEqual(
      ['aggregate', 'compute', 'dedup', 'explode_json', 'filter', 'join', 'rename'],
    );
  });

  describe('join', () => {
    it('accepts an inner/left join with a non-empty on key set', () => {
      const cfg = { left: 'orders', right: 'refunds', type: 'inner', on: [{ leftField: 'orderId', rightField: 'orderId' }] };
      expect(validatePipelineStep('join', cfg)).toEqual(cfg);
    });

    it('rejects an unknown join type', () => {
      expect(() =>
        validatePipelineStep('join', { left: 'a', right: 'b', type: 'cross', on: [{ leftField: 'k', rightField: 'k' }] }),
      ).toThrow(BadRequestException);
    });

    it('rejects an empty on key set', () => {
      expect(() =>
        validatePipelineStep('join', { left: 'a', right: 'b', type: 'inner', on: [] }),
      ).toThrow(BadRequestException);
    });
  });

  describe('explode_json', () => {
    it('accepts array mode and object mode', () => {
      expect(validatePipelineStep('explode_json', { field: 'events', mode: 'array' })).toEqual({ field: 'events', mode: 'array' });
      expect(validatePipelineStep('explode_json', { field: 'payload', mode: 'object' })).toEqual({ field: 'payload', mode: 'object' });
    });

    it('rejects an unknown mode', () => {
      expect(() => validatePipelineStep('explode_json', { field: 'x', mode: 'sideways' })).toThrow(BadRequestException);
    });

    it('rejects a missing field', () => {
      expect(() => validatePipelineStep('explode_json', { mode: 'array' })).toThrow(BadRequestException);
    });
  });

  describe('dedup', () => {
    it('accepts a non-empty keys array', () => {
      expect(validatePipelineStep('dedup', { keys: ['a', 'b'] })).toEqual({ keys: ['a', 'b'] });
    });

    it('rejects an empty keys array', () => {
      expect(() => validatePipelineStep('dedup', { keys: [] })).toThrow(BadRequestException);
    });
  });

  describe('aggregate', () => {
    it('accepts groupBy + metrics with known ops', () => {
      const cfg = { groupBy: ['cat'], metrics: [{ op: 'sum', field: 'v', as: 'total' }, { op: 'count', as: 'n' }] };
      expect(validatePipelineStep('aggregate', cfg)).toEqual(cfg);
    });

    it('rejects an unknown metric op', () => {
      expect(() =>
        validatePipelineStep('aggregate', { groupBy: ['cat'], metrics: [{ op: 'median', field: 'v', as: 'm' }] }),
      ).toThrow(BadRequestException);
    });

    it('rejects empty groupBy', () => {
      expect(() =>
        validatePipelineStep('aggregate', { groupBy: [], metrics: [{ op: 'count', as: 'n' }] }),
      ).toThrow(BadRequestException);
    });
  });

  describe('filter', () => {
    it('accepts a single-condition filter with a known operator', () => {
      const cfg = { field: 'status', operator: 'eq', value: 'active' };
      expect(validatePipelineStep('filter', cfg)).toEqual(cfg);
    });

    it('rejects an unknown operator', () => {
      expect(() => validatePipelineStep('filter', { field: 'x', operator: 'regex', value: 'y' })).toThrow(
        BadRequestException,
      );
    });

    it('rejects a composite (AND/OR) shape', () => {
      // composite conditions must be expressed as multiple filter steps (Q7a)
      expect(() =>
        validatePipelineStep('filter', { and: [{ field: 'a', operator: 'eq', value: 1 }] }),
      ).toThrow(BadRequestException);
    });
  });

  describe('rename', () => {
    it('accepts a mappings record', () => {
      const cfg = { mappings: { old_name: 'new_name' } };
      expect(validatePipelineStep('rename', cfg)).toEqual(cfg);
    });

    it('rejects a rename missing mappings', () => {
      expect(() => validatePipelineStep('rename', { from: 'a', to: 'b' })).toThrow(BadRequestException);
    });
  });

  describe('compute', () => {
    it('accepts an inline-params compute', () => {
      const cfg = {
        function: 'price_band',
        inputField: 'price',
        outputField: 'band',
        params: { bands: [{ label: 'cheap' }] },
      };
      expect(validatePipelineStep('compute', cfg)).toEqual(cfg);
    });

    it('accepts a configRef compute', () => {
      const cfg = {
        function: 'normalize_brand',
        inputField: 'brand',
        outputField: 'brand_norm',
        configRef: 'brand-dict',
        configVersion: 2,
      };
      expect(validatePipelineStep('compute', cfg)).toEqual(cfg);
    });

    it('rejects an unknown function', () => {
      expect(() =>
        validatePipelineStep('compute', { function: 'frobnicate', inputField: 'a', outputField: 'b' }),
      ).toThrow(BadRequestException);
    });

    it('accepts a concat compute (fields + separator, no inputField) (#177)', () => {
      const cfg = {
        function: 'concat',
        fields: ['category', 'brand', 'priceBand', 'period'],
        separator: '_',
        outputField: 'externalId',
      };
      expect(validatePipelineStep('compute', cfg)).toEqual(cfg);
    });

    it('rejects a stray key on a concat compute (.strict())', () => {
      expect(() =>
        validatePipelineStep('compute', { function: 'concat', fields: ['a'], outputField: 'k', bogus: 1 }),
      ).toThrow(BadRequestException);
    });
  });

  it('throws BadRequestException for an unknown step type', () => {
    expect(() => validatePipelineStep('explode', {})).toThrow(BadRequestException);
  });
});
