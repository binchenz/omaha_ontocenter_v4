import { SALES_RECORD_DEF, SALES_LINE_DEF, SALES_RECORD_TYPE, SALES_LINE_TYPE } from './sales-stars';

// The reference vertical is the community template (ADR-0062 §4 / #207): it must demo EVERY
// ADR-0061 semantic once, neutrally. These tests pin the schema contract a community OPC copies.
describe('Sales Records reference vertical — star schema (ADR-0062 §4)', () => {
  describe('sales_record (summary, long-format)', () => {
    const prop = (n: string) => SALES_RECORD_DEF.properties.find(p => p.name === n) as any;

    it('is a long-format star: one `value` column keyed by a `metric` dimension', () => {
      expect(SALES_RECORD_DEF.name).toBe(SALES_RECORD_TYPE);
      expect(prop('metric').allowedValues).toEqual(['units_sold', 'revenue', 'avg_price']);
      expect(prop('value').type).toBe('number');
    });

    it('demos collapsedDefault: region is defaulted AND surfaced as collapsed (ADR-0061 §3)', () => {
      expect(SALES_RECORD_DEF.dimensions.defaults).toMatchObject({ region: '全国' });
      expect((SALES_RECORD_DEF.dimensions as any).collapsedDefault).toMatchObject({ region: '全国' });
    });

    it('demos whole-market universe (ADR-0061 §2)', () => {
      expect(SALES_RECORD_DEF.semantics.universe).toBe('whole-market');
    });

    it('requires product + period as the minimal query scope', () => {
      expect(SALES_RECORD_DEF.dimensions.required).toEqual(['product', 'period']);
    });
  });

  describe('sales_line (detail, per-SKU sample)', () => {
    const prop = (n: string) => SALES_LINE_DEF.properties.find(p => p.name === n) as any;

    it('demos additivity tagging: unitsSold additive, unitPrice ratio (ADR-0061 §1)', () => {
      expect(prop('unitsSold').additivity).toBe('additive');
      expect(prop('unitPrice').additivity).toBe('ratio');
    });

    it('demos top-sample universe so "no SKU in a band" is not read as zero share (ADR-0061 §2)', () => {
      expect(SALES_LINE_DEF.name).toBe(SALES_LINE_TYPE);
      expect(SALES_LINE_DEF.semantics.universe).toBe('top-sample');
    });
  });
});
