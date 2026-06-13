import { InlineTransformEngine, InlineTransform } from './inline-transform-engine';

describe('InlineTransformEngine', () => {
  describe('multiply operation', () => {
    it('should multiply numeric values by scalar', () => {
      const rows = [
        { '零售额(万元)': '123.4', '品牌': '美的' },
        { '零售额(万元)': '567.8', '品牌': '海尔' },
      ];

      const transforms: InlineTransform[] = [
        { column: '零售额(万元)', op: 'multiply', arg: 10000, outputColumn: '零售额' },
      ];

      const result = InlineTransformEngine.apply(rows, transforms);

      expect(result).toEqual([
        { '零售额(万元)': '123.4', '品牌': '美的', '零售额': 1234000 },
        { '零售额(万元)': '567.8', '品牌': '海尔', '零售额': 5678000 },
      ]);
    });

    it('should overwrite source column if outputColumn not specified', () => {
      const rows = [{ value: 10 }];
      const transforms: InlineTransform[] = [
        { column: 'value', op: 'multiply', arg: 5 },
      ];

      const result = InlineTransformEngine.apply(rows, transforms);

      expect(result).toEqual([{ value: 50 }]);
    });
  });

  describe('divide operation', () => {
    it('should divide numeric values by scalar', () => {
      const rows = [{ price: 100 }, { price: 200 }];
      const transforms: InlineTransform[] = [
        { column: 'price', op: 'divide', arg: 2 },
      ];

      const result = InlineTransformEngine.apply(rows, transforms);

      expect(result).toEqual([{ price: 50 }, { price: 100 }]);
    });
  });

  describe('map operation', () => {
    it('should replace values via dictionary lookup', () => {
      const rows = [
        { brand: '美的' },
        { brand: '海尔' },
        { brand: '其他' },
      ];

      const transforms: InlineTransform[] = [
        {
          column: 'brand',
          op: 'map',
          arg: { '美的': 'Midea', '海尔': 'Haier' },
        },
      ];

      const result = InlineTransformEngine.apply(rows, transforms);

      expect(result).toEqual([
        { brand: 'Midea' },
        { brand: 'Haier' },
        { brand: '其他' }, // unmapped values pass through
      ]);
    });
  });

  describe('compute operation', () => {
    it('should evaluate simple arithmetic expressions', () => {
      const rows = [
        { price: 10, quantity: 5 },
        { price: 20, quantity: 3 },
      ];

      const transforms: InlineTransform[] = [
        { column: 'total', op: 'compute', arg: 'price * quantity' },
      ];

      const result = InlineTransformEngine.apply(rows, transforms);

      expect(result).toEqual([
        { price: 10, quantity: 5, total: 50 },
        { price: 20, quantity: 3, total: 60 },
      ]);
    });
  });

  describe('error handling', () => {
    it('should throw error for missing column', () => {
      const rows = [{ a: 1 }];
      const transforms: InlineTransform[] = [
        { column: 'nonexistent', op: 'multiply', arg: 2 },
      ];

      expect(() => InlineTransformEngine.apply(rows, transforms)).toThrow(
        "Column 'nonexistent' not found",
      );
    });

    it('should throw error for non-numeric value in arithmetic operation', () => {
      const rows = [{ value: 'text' }];
      const transforms: InlineTransform[] = [
        { column: 'value', op: 'multiply', arg: 2 },
      ];

      expect(() => InlineTransformEngine.apply(rows, transforms)).toThrow(
        'Cannot multiply non-numeric value',
      );
    });
  });

  describe('chained transforms', () => {
    it('should apply multiple transforms in sequence', () => {
      const rows = [{ '零售额(万元)': '10.5' }];

      const transforms: InlineTransform[] = [
        { column: '零售额(万元)', op: 'multiply', arg: 10000, outputColumn: '零售额' },
        { column: '零售额', op: 'divide', arg: 2, outputColumn: '半价零售额' },
      ];

      const result = InlineTransformEngine.apply(rows, transforms);

      expect(result).toEqual([
        { '零售额(万元)': '10.5', '零售额': 105000, '半价零售额': 52500 },
      ]);
    });
  });
});
