/**
 * Unit tests for verdict-helpers.ts
 *
 * Validates the three new schema verdict functions plus re-exported
 * delivery-report verdicts with edge cases.
 */

import {
  compareNumeric,
  compareRanking,
  checkTextConsistency,
  verifyFieldExists,
  verifyFieldBackfilled,
  verifyDimensionConstraint,
} from './verdict-helpers';
import type { SchemaChangeVerificationResult } from './schema-validation';
import { PrismaService } from '@omaha/db';

describe('verdict-helpers', () => {
  // ============================================================================
  // Re-exported delivery-report verdicts
  // ============================================================================

  describe('compareNumeric', () => {
    it('should pass within default tolerance (0.5%)', () => {
      const result = compareNumeric({
        groundTruth: 100000,
        actual: 100400, // 0.4% error
      });
      expect(result.pass).toBe(true);
    });

    it('should fail outside default tolerance', () => {
      const result = compareNumeric({
        groundTruth: 100000,
        actual: 100600, // 0.6% error
      });
      expect(result.pass).toBe(false);
    });

    it('should respect custom tolerance', () => {
      const result = compareNumeric({
        groundTruth: 28612345,
        actual: 28600000, // ~0.04% error
        relTolerance: 0.01, // 1% tolerance
      });
      expect(result.pass).toBe(true);
    });

    it('should handle zero ground truth', () => {
      const result = compareNumeric({
        groundTruth: 0,
        actual: 0.001,
      });
      expect(result.pass).toBe(true);
    });

    it('should fail when actual is null', () => {
      const result = compareNumeric({
        groundTruth: 100000,
        actual: null,
      });
      expect(result.pass).toBe(false);
      expect(result.detail).toContain('未取到数值');
    });
  });

  describe('compareRanking', () => {
    it('should pass with set equality (order-insensitive)', () => {
      const result = compareRanking({
        groundTruth: ['美的', '九阳', '苏泊尔', '小米', '米家'],
        actual: ['小米', '美的', '米家', '九阳', '苏泊尔'], // Reordered
        requireOrder: false,
      });
      expect(result.pass).toBe(true);
    });

    it('should fail when order is wrong and requireOrder=true', () => {
      const result = compareRanking({
        groundTruth: ['美的', '九阳', '苏泊尔'],
        actual: ['九阳', '美的', '苏泊尔'],
        requireOrder: true,
      });
      expect(result.pass).toBe(false);
    });

    it('should fail with fabricated brand', () => {
      const result = compareRanking({
        groundTruth: ['美的', '九阳', '苏泊尔'],
        actual: ['美的', '九阳', '松下'], // 松下 not in ground truth
        requireOrder: false,
      });
      expect(result.pass).toBe(false);
      expect(result.detail).toContain('多出/编造');
    });

    it('should normalize whitespace', () => {
      const result = compareRanking({
        groundTruth: ['美的', '九阳', '苏泊尔'],
        actual: ['美的 ', ' 九阳', '苏泊尔'],
        requireOrder: false,
      });
      expect(result.pass).toBe(true);
    });

    it('should handle ties with set equality', () => {
      const result = compareRanking({
        groundTruth: ['美的', '九阳', '苏泊尔'], // Share: 30%, 12.34%, 12.34%
        actual: ['美的', '苏泊尔', '九阳'], // Flipped tied brands
        requireOrder: false,
      });
      expect(result.pass).toBe(true);
    });
  });

  describe('checkTextConsistency', () => {
    it('should parse 万 multiplier (10^4)', () => {
      const result = checkTextConsistency({
        text: '2024年纯米品牌零售额约为 2861 万元',
        groundTruth: 28612345,
        relTolerance: 0.03,
      });
      expect(result.pass).toBe(true);
    });

    it('should parse 亿 multiplier (10^8)', () => {
      const result = checkTextConsistency({
        text: '全市场规模达到 12.5 亿元',
        groundTruth: 1250000000,
      });
      expect(result.pass).toBe(true);
    });

    it('should parse comma-separated integer', () => {
      const result = checkTextConsistency({
        text: '销量为 28,612,345 台',
        groundTruth: 28612345,
      });
      expect(result.pass).toBe(true);
    });

    it('should handle unit-in-DB case', () => {
      const result = checkTextConsistency({
        text: '零售额为 24,269 万元',
        groundTruth: 24269, // DB value already in 万 units
      });
      expect(result.pass).toBe(true);
    });

    it('should find best match among multiple numbers', () => {
      const result = checkTextConsistency({
        text: '美的占 30.5%，九阳占 2861 万元零售额',
        groundTruth: 28612345,
      });
      expect(result.pass).toBe(true);
    });

    it('should fail when no parseable numbers', () => {
      const result = checkTextConsistency({
        text: '数据不足，无法提供具体数值',
        groundTruth: 28612345,
      });
      expect(result.pass).toBe(false);
      expect(result.detail).toContain('未出现可比对的数值');
    });

    it('should tolerate coarse rounding in prose', () => {
      const result = checkTextConsistency({
        text: '约 2900 万元',
        groundTruth: 28612345,
        relTolerance: 0.03,
      });
      // 2900万 = 29,000,000, error ≈ 1.4% < 3%
      expect(result.pass).toBe(true);
    });
  });

  // ============================================================================
  // New schema verification verdicts
  // ============================================================================

  describe('verifyFieldExists', () => {
    it('should pass when field exists in all three layers', () => {
      const mockResult: SchemaChangeVerificationResult = {
        passed: true,
        layers: {
          db: {
            layer: 'DB',
            passed: true,
            missingFields: [],
            typeMismatches: [],
            nullabilityMismatches: [],
            ghostFields: [],
          },
          matview: {
            layer: 'Matview',
            passed: true,
            missingFields: [],
            typeMismatches: [],
            nullabilityMismatches: [],
            ghostFields: [],
          },
          ontology: {
            layer: 'OntologyView',
            passed: true,
            missingFields: [],
            typeMismatches: [],
            nullabilityMismatches: [],
            ghostFields: [],
          },
        },
        fieldResults: [
          {
            field: 'year',
            dbPresent: true,
            matviewPresent: true,
            ontologyPresent: true,
            issues: [],
          },
        ],
        summary: '',
      };

      const verdict = verifyFieldExists(mockResult, 'year');
      expect(verdict.pass).toBe(true);
      expect(verdict.detail).toContain('三层全部存在');
    });

    it('should fail when field missing from one layer', () => {
      const mockResult: SchemaChangeVerificationResult = {
        passed: false,
        layers: {
          db: {
            layer: 'DB',
            passed: true,
            missingFields: [],
            typeMismatches: [],
            nullabilityMismatches: [],
            ghostFields: [],
          },
          matview: {
            layer: 'Matview',
            passed: false,
            missingFields: ['year'],
            typeMismatches: [],
            nullabilityMismatches: [],
            ghostFields: [],
          },
          ontology: {
            layer: 'OntologyView',
            passed: true,
            missingFields: [],
            typeMismatches: [],
            nullabilityMismatches: [],
            ghostFields: [],
          },
        },
        fieldResults: [
          {
            field: 'year',
            dbPresent: true,
            matviewPresent: false,
            ontologyPresent: true,
            issues: ['Missing in Matview layer'],
          },
        ],
        summary: '',
      };

      const verdict = verifyFieldExists(mockResult, 'year');
      expect(verdict.pass).toBe(false);
      expect(verdict.detail).toContain('缺失于：Matview');
    });

    it('should fail when field not in expectedFields', () => {
      const mockResult: SchemaChangeVerificationResult = {
        passed: true,
        layers: {
          db: {
            layer: 'DB',
            passed: true,
            missingFields: [],
            typeMismatches: [],
            nullabilityMismatches: [],
            ghostFields: [],
          },
          matview: {
            layer: 'Matview',
            passed: true,
            missingFields: [],
            typeMismatches: [],
            nullabilityMismatches: [],
            ghostFields: [],
          },
          ontology: {
            layer: 'OntologyView',
            passed: true,
            missingFields: [],
            typeMismatches: [],
            nullabilityMismatches: [],
            ghostFields: [],
          },
        },
        fieldResults: [],
        summary: '',
      };

      const verdict = verifyFieldExists(mockResult, 'nonexistent');
      expect(verdict.pass).toBe(false);
      expect(verdict.detail).toContain('不在验证范围内');
    });

    it('should report all missing layers', () => {
      const mockResult: SchemaChangeVerificationResult = {
        passed: false,
        layers: {
          db: {
            layer: 'DB',
            passed: false,
            missingFields: ['year'],
            typeMismatches: [],
            nullabilityMismatches: [],
            ghostFields: [],
          },
          matview: {
            layer: 'Matview',
            passed: false,
            missingFields: ['year'],
            typeMismatches: [],
            nullabilityMismatches: [],
            ghostFields: [],
          },
          ontology: {
            layer: 'OntologyView',
            passed: true,
            missingFields: [],
            typeMismatches: [],
            nullabilityMismatches: [],
            ghostFields: [],
          },
        },
        fieldResults: [
          {
            field: 'year',
            dbPresent: false,
            matviewPresent: false,
            ontologyPresent: true,
            issues: ['Missing in DB layer', 'Missing in Matview layer'],
          },
        ],
        summary: '',
      };

      const verdict = verifyFieldExists(mockResult, 'year');
      expect(verdict.pass).toBe(false);
      expect(verdict.detail).toContain('DB');
      expect(verdict.detail).toContain('Matview');
      expect(verdict.detail).not.toContain('Ontology');
    });
  });

  describe('verifyFieldBackfilled', () => {
    let mockPrisma: jest.Mocked<PrismaService>;

    beforeEach(() => {
      mockPrisma = {
        objectType: {
          findFirst: jest.fn(),
        },
        $queryRawUnsafe: jest.fn(),
      } as any;
    });

    it('should pass when field is backfilled', async () => {
      mockPrisma.objectType.findFirst.mockResolvedValue({
        id: 'obj-type-123',
      });
      mockPrisma.$queryRawUnsafe.mockResolvedValue([{ count: BigInt(1000) }]);

      const verdict = await verifyFieldBackfilled(
        mockPrisma,
        'tenant-123',
        'rice_cooker_sales',
        'year',
        100,
      );

      expect(verdict.pass).toBe(true);
      expect(verdict.detail).toContain('1000 行非 NULL');

      // Verify the SQL query was constructed correctly
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('object_instances'),
        'tenant-123',
        'rice_cooker_sales',
        'year',
      );
    });

    it('should fail when backfill is insufficient', async () => {
      mockPrisma.objectType.findFirst.mockResolvedValue({
        id: 'obj-type-123',
      });
      mockPrisma.$queryRawUnsafe.mockResolvedValue([{ count: BigInt(50) }]);

      const verdict = await verifyFieldBackfilled(
        mockPrisma,
        'tenant-123',
        'rice_cooker_sales',
        'year',
        100,
      );

      expect(verdict.pass).toBe(false);
      expect(verdict.detail).toContain('50 行非 NULL');
      expect(verdict.detail).toContain('需要 ≥ 100');
    });

    it('should fail when object type not found', async () => {
      mockPrisma.objectType.findFirst.mockResolvedValue(null);

      const verdict = await verifyFieldBackfilled(
        mockPrisma,
        'tenant-123',
        'nonexistent',
        'year',
        1,
      );

      expect(verdict.pass).toBe(false);
      expect(verdict.detail).toContain('不存在');
    });

    it('should use default minRows=1', async () => {
      mockPrisma.objectType.findFirst.mockResolvedValue({
        id: 'obj-type-123',
      });
      mockPrisma.$queryRawUnsafe.mockResolvedValue([{ count: BigInt(5) }]);

      const verdict = await verifyFieldBackfilled(
        mockPrisma,
        'tenant-123',
        'rice_cooker_sales',
        'year',
        // minRows not specified, defaults to 1
      );

      expect(verdict.pass).toBe(true);
    });

    it('should query properties JSONB column correctly', async () => {
      mockPrisma.objectType.findFirst.mockResolvedValue({
        id: 'obj-type-123',
      });
      mockPrisma.$queryRawUnsafe.mockResolvedValue([{ count: BigInt(100) }]);

      await verifyFieldBackfilled(
        mockPrisma,
        'tenant-123',
        'rice_cooker_sales',
        'year',
        50,
      );

      // Verify SQL uses properties->>fieldName pattern
      const sqlCall = mockPrisma.$queryRawUnsafe.mock.calls[0];
      expect(sqlCall[0]).toContain("properties->>$3 IS NOT NULL");
      expect(sqlCall[0]).toContain("deleted_at IS NULL");
    });
  });

  describe('verifyDimensionConstraint', () => {
    it('should pass with correct optional dimension with default', () => {
      const mockObjectType = {
        dimensions: {
          priceBand: {
            required: false,
            default: '整体',
          },
        },
      };

      const verdict = verifyDimensionConstraint(
        mockObjectType,
        'priceBand',
        false,
        '整体',
      );

      expect(verdict.pass).toBe(true);
      expect(verdict.detail).toContain('可选');
      expect(verdict.detail).toContain('默认值');
    });

    it('should pass with correct required dimension with no default', () => {
      const mockObjectType = {
        dimensions: {
          period: {
            required: true,
          },
        },
      };

      const verdict = verifyDimensionConstraint(
        mockObjectType,
        'period',
        true,
        null,
      );

      expect(verdict.pass).toBe(true);
      expect(verdict.detail).toContain('必需');
    });

    it('should fail when required flag is wrong', () => {
      const mockObjectType = {
        dimensions: {
          priceBand: {
            required: false,
            default: '整体',
          },
        },
      };

      const verdict = verifyDimensionConstraint(
        mockObjectType,
        'priceBand',
        true, // Expected true, but actual is false
        '整体',
      );

      expect(verdict.pass).toBe(false);
      expect(verdict.detail).toContain('required');
    });

    it('should fail when default value is wrong', () => {
      const mockObjectType = {
        dimensions: {
          priceBand: {
            required: false,
            default: '整体',
          },
        },
      };

      const verdict = verifyDimensionConstraint(
        mockObjectType,
        'priceBand',
        false,
        '低端', // Expected '低端', but actual is '整体'
      );

      expect(verdict.pass).toBe(false);
      expect(verdict.detail).toContain('default');
    });

    it('should fail when dimension does not exist', () => {
      const mockObjectType = {
        dimensions: {
          priceBand: {
            required: false,
            default: '整体',
          },
        },
      };

      const verdict = verifyDimensionConstraint(
        mockObjectType,
        'nonexistent',
        false,
        null,
      );

      expect(verdict.pass).toBe(false);
      expect(verdict.detail).toContain('不存在');
    });

    it('should handle missing default key as null', () => {
      const mockObjectType = {
        dimensions: {
          channel: {
            required: false,
            // No 'default' key
          },
        },
      };

      const verdict = verifyDimensionConstraint(
        mockObjectType,
        'channel',
        false,
        null,
      );

      expect(verdict.pass).toBe(true);
    });

    it('should handle empty dimensions object', () => {
      const mockObjectType = {
        dimensions: {},
      };

      const verdict = verifyDimensionConstraint(
        mockObjectType,
        'priceBand',
        false,
        null,
      );

      expect(verdict.pass).toBe(false);
      expect(verdict.detail).toContain('不存在');
    });
  });
});
