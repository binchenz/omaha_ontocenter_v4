/**
 * Demonstration script for verdict-helpers.ts
 *
 * Shows all verdict functions with realistic examples.
 * Run with: npx ts-node test/ontology-harness/verdict-helpers-demo.ts
 */

import {
  compareNumeric,
  compareRanking,
  checkTextConsistency,
  verifyFieldExists,
  verifyDimensionConstraint,
} from './verdict-helpers.js';

console.log('='.repeat(80));
console.log('Verdict Helpers Demo - Phase 1 Implementation');
console.log('='.repeat(80));
console.log();

// ============================================================================
// 1. compareNumeric - Tolerance edge cases
// ============================================================================
console.log('1. compareNumeric - Tolerance edge cases');
console.log('-'.repeat(80));

const case1a = compareNumeric({
  groundTruth: 100000,
  actual: 100400, // 0.4% error
});
console.log('✓ Within default tolerance (0.5%):', case1a);

const case1b = compareNumeric({
  groundTruth: 100000,
  actual: 100600, // 0.6% error
});
console.log('✗ Outside default tolerance:', case1b);

const case1c = compareNumeric({
  groundTruth: 28612345,
  actual: 28600000,
  relTolerance: 0.01, // 1% custom tolerance
});
console.log('✓ Custom tolerance for rounding:', case1c);

console.log();

// ============================================================================
// 2. compareRanking - Ranking ties
// ============================================================================
console.log('2. compareRanking - Ranking ties and order-sensitivity');
console.log('-'.repeat(80));

const case2a = compareRanking({
  groundTruth: ['美的', '九阳', '苏泊尔', '小米', '米家'],
  actual: ['小米', '美的', '米家', '九阳', '苏泊尔'], // Reordered
  requireOrder: false,
});
console.log('✓ Set equality (order-insensitive):', case2a);

const case2b = compareRanking({
  groundTruth: ['美的', '九阳', '苏泊尔'],
  actual: ['九阳', '美的', '苏泊尔'],
  requireOrder: true,
});
console.log('✗ Strict order fails on reordering:', case2b);

const case2c = compareRanking({
  groundTruth: ['美的', '九阳', '苏泊尔'],
  actual: ['美的', '九阳', '松下'], // 松下 not in ground truth
  requireOrder: false,
});
console.log('✗ Fabricated brand detected:', case2c);

console.log();

// ============================================================================
// 3. checkTextConsistency - Chinese magnitude parsing (万/亿)
// ============================================================================
console.log('3. checkTextConsistency - Chinese magnitude parsing');
console.log('-'.repeat(80));

const case3a = checkTextConsistency({
  text: '2024年纯米品牌零售额约为 2861 万元',
  groundTruth: 28612345,
  relTolerance: 0.03,
});
console.log('✓ Parse 2861万 → 28,610,000:', case3a);

const case3b = checkTextConsistency({
  text: '全市场规模达到 12.5 亿元',
  groundTruth: 1250000000,
});
console.log('✓ Parse 12.5亿 → 1,250,000,000:', case3b);

const case3c = checkTextConsistency({
  text: '零售额为 24,269 万元',
  groundTruth: 24269, // DB value already in 万 units
});
console.log('✓ Unit-in-DB case (parser emits both):', case3c);

const case3d = checkTextConsistency({
  text: '数据不足，无法提供具体数值',
  groundTruth: 28612345,
});
console.log('✗ No parseable numbers:', case3d);

const case3e = checkTextConsistency({
  text: '约 2900 万元', // Coarsely rounded
  groundTruth: 28612345,
  relTolerance: 0.03,
});
console.log('✓ Coarse rounding tolerance (1.4% < 3%):', case3e);

console.log();

// ============================================================================
// 4. verifyFieldExists - Three-layer schema verification
// ============================================================================
console.log('4. verifyFieldExists - Three-layer schema verification');
console.log('-'.repeat(80));

const mockSchemaResult = {
  passed: false,
  layers: {
    db: {
      layer: 'DB' as const,
      passed: true,
      missingFields: [],
      typeMismatches: [],
      nullabilityMismatches: [],
      ghostFields: [],
    },
    matview: {
      layer: 'Matview' as const,
      passed: false,
      missingFields: ['year'],
      typeMismatches: [],
      nullabilityMismatches: [],
      ghostFields: [],
    },
    ontology: {
      layer: 'OntologyView' as const,
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

const case4 = verifyFieldExists(mockSchemaResult, 'year');
console.log('✗ Field missing from Matview:', case4);

console.log();

// ============================================================================
// 5. verifyDimensionConstraint - ADR-0057 dimension config
// ============================================================================
console.log('5. verifyDimensionConstraint - ADR-0057 dimension constraints');
console.log('-'.repeat(80));

const mockObjectType = {
  dimensions: {
    priceBand: {
      required: false,
      default: '整体',
    },
    period: {
      required: true,
    },
    channel: {
      required: false,
      // No 'default' key
    },
  },
};

const case5a = verifyDimensionConstraint(
  mockObjectType,
  'priceBand',
  false,
  '整体',
);
console.log('✓ Optional dimension with default:', case5a);

const case5b = verifyDimensionConstraint(
  mockObjectType,
  'period',
  true,
  null,
);
console.log('✓ Required dimension with no default:', case5b);

const case5c = verifyDimensionConstraint(
  mockObjectType,
  'priceBand',
  true, // Expected required=true, but actual is false
  '整体',
);
console.log('✗ Wrong required flag:', case5c);

const case5d = verifyDimensionConstraint(
  mockObjectType,
  'channel',
  false,
  null, // Missing 'default' key treated as null
);
console.log('✓ Missing default key handled as null:', case5d);

console.log();
console.log('='.repeat(80));
console.log('All verdict functions demonstrated successfully!');
console.log('='.repeat(80));
