import { toInstanceDto } from './to-instance-dto';

describe('toInstanceDto', () => {
  const props = { amount: 100, status: 'paid', paidAmount: 100, secret: 'x' };

  it('returns all properties for ⊤ (null allowedFields)', () => {
    expect(toInstanceDto(props, null)).toEqual(props);
  });

  it('masks to the allowed field set', () => {
    expect(toInstanceDto(props, new Set(['amount', 'status']))).toEqual({
      amount: 100,
      status: 'paid',
    });
  });

  it('applies select AFTER masking — select cannot surface a masked field', () => {
    // secret is masked out; selecting it must not bring it back.
    const out = toInstanceDto(props, new Set(['amount', 'status']), ['amount', 'secret']);
    expect(out).toEqual({ amount: 100 });
    expect('secret' in out).toBe(false);
  });

  it('applies select within the visible set for ⊤', () => {
    expect(toInstanceDto(props, null, ['amount'])).toEqual({ amount: 100 });
  });

  it('tolerates null/undefined properties', () => {
    expect(toInstanceDto(null, new Set(['amount']))).toEqual({});
    expect(toInstanceDto(undefined, null)).toEqual({});
  });

  it('ignores allowed fields not present on the row', () => {
    expect(toInstanceDto({ amount: 1 }, new Set(['amount', 'missing']))).toEqual({ amount: 1 });
  });
});
