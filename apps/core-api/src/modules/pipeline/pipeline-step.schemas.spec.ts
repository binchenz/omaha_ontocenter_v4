import { BadRequestException } from '@nestjs/common';
import { validatePipelineStep, PIPELINE_STEP_SCHEMAS } from './pipeline-step.schemas';

describe('pipeline-step schemas (ADR-0053)', () => {
  it('exposes filter/rename/compute schema entries', () => {
    expect(Object.keys(PIPELINE_STEP_SCHEMAS).sort()).toEqual(['compute', 'filter', 'rename']);
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
  });

  it('throws BadRequestException for an unknown step type', () => {
    expect(() => validatePipelineStep('explode', {})).toThrow(BadRequestException);
  });
});
