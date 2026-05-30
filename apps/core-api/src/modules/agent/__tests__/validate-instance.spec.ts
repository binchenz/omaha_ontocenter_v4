import { validateInstanceProperties } from '@omaha/shared-types';
import type { PropertyDefinition } from '@omaha/shared-types';

const defs: PropertyDefinition[] = [
  { name: 'status', label: '状态', type: 'string', allowedValues: ['pending', 'paid', 'refunded'] },
  { name: 'note', label: '备注', type: 'string' },
  { name: 'amount', label: '金额', type: 'number' },
];

describe('validateInstanceProperties (allowedValues gate)', () => {
  it('passes when value is in the allowed set', () => {
    expect(validateInstanceProperties({ status: 'paid' }, defs)).toEqual([]);
  });

  it('flags a value outside the allowed set', () => {
    const v = validateInstanceProperties({ status: 'shipped' }, defs);
    expect(v).toEqual([{ field: 'status', value: 'shipped', allowed: ['pending', 'paid', 'refunded'] }]);
  });

  it('skips empty / null / undefined (does not imply required)', () => {
    expect(validateInstanceProperties({ status: '' }, defs)).toEqual([]);
    expect(validateInstanceProperties({ status: null }, defs)).toEqual([]);
    expect(validateInstanceProperties({}, defs)).toEqual([]);
  });

  it('trims before comparing', () => {
    expect(validateInstanceProperties({ status: '  paid  ' }, defs)).toEqual([]);
  });

  it('ignores fields without allowedValues and non-string defs', () => {
    expect(validateInstanceProperties({ note: 'anything', amount: 999 }, defs)).toEqual([]);
  });

  it('collects multiple violations across fields', () => {
    const multi: PropertyDefinition[] = [
      ...defs,
      { name: 'grade', label: '等级', type: 'string', allowedValues: ['A', 'B'] },
    ];
    const v = validateInstanceProperties({ status: 'x', grade: 'Z' }, multi);
    expect(v.map((x) => x.field).sort()).toEqual(['grade', 'status']);
  });
});
