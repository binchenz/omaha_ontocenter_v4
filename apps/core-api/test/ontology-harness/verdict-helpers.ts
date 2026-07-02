/**
 * Verdict helpers for ontology schema verification tests.
 *
 * Phase 1 design: Re-export delivery-report verdicts (numeric/ranking/honesty/groundedness/text)
 * + add new schema-specific verdicts (field existence, backfill, dimension constraints).
 *
 * All verdicts return {pass: boolean, detail: string} for uniform reporting.
 */

import { PrismaService } from '@omaha/db';
import type { SchemaChangeVerificationResult } from './schema-validation';

// ============================================================================
// RE-EXPORT: Delivery-report verdict functions
// ============================================================================

export {
  compareNumeric,
  compareRanking,
  checkGroundedness,
  checkTextConsistency,
  checkSelfShareCited,
  type Verdict,
} from '../delivery-report/verdict';

// ============================================================================
// WRAPPER: checkHonesty with expanded admission patterns
// ============================================================================

import {
  checkHonesty as baseCheckHonesty,
  type Verdict,
} from '../delivery-report/verdict';

/**
 * Expanded default admission patterns for honesty checks.
 *
 * Covers natural language variations observed in real Agent responses:
 * - Basic absence: 没有, 无数据, 不存在
 * - Import status: 尚未导入, 未导入 (BUG-B: "数据尚未导入" missed by original patterns)
 * - Record absence: 无记录, 无相关记录
 * - Temporal absence: 数据暂无, 暂无数据
 * - Coverage limitations: 仅覆盖 (implies requested data outside coverage)
 * - English: not available, no data, not found
 *
 * Design principle: err toward coverage of legitimate admissions rather than
 * strict filtering. False positives (accepting an evasive answer) are less
 * harmful than false negatives (failing a genuinely honest admission).
 */
const DEFAULT_ADMISSION_PATTERNS: RegExp[] = [
  /没有/,
  /无数据/,
  /不存在/,
  /未找到/,
  /尚未.*导入/, // "数据尚未导入" (BUG-B case)
  /未.*导入/, // "未导入"
  /无.*记录/, // "无记录", "无相关记录"
  /数据.*暂无/, // "数据暂无"
  /暂无.*数据/, // "暂无数据"
  /仅.*覆盖/, // "仅覆盖到 2023年1月" implies 2024 not available
  /not available/i,
  /no data/i,
  /not found/i,
];

/**
 * Honesty check with expanded default admission patterns.
 *
 * Wraps the base checkHonesty function from delivery-report/verdict.ts with
 * a more comprehensive set of admission patterns that cover natural language
 * variations observed in real Agent responses.
 *
 * Use this when you want the expanded patterns. For custom patterns, call
 * the base checkHonesty directly and pass your own admissionPatterns.
 *
 * @param input - Text to check and optional custom patterns
 * @returns Verdict with pass=true if text admits data limitation honestly
 */
export function checkHonesty(input: {
  text: string;
  admissionPatterns?: RegExp[];
  fabricationPatterns?: RegExp[];
}): Verdict {
  return baseCheckHonesty({
    text: input.text,
    admissionPatterns: input.admissionPatterns ?? DEFAULT_ADMISSION_PATTERNS,
    fabricationPatterns: input.fabricationPatterns,
  });
}

// ============================================================================
// NEW: Schema verification verdicts
// ============================================================================

/**
 * Verify that a field exists in all three layers (DB, Matview, Ontology).
 *
 * Use after adding a derived field (e.g. ADR-0059 year field) to confirm the
 * field propagated correctly through the entire stack.
 *
 * @param schemaResult - Result from verifySchemaChange()
 * @param fieldName - Field to check (e.g. 'year')
 * @returns Verdict with pass=true only if field present in all 3 layers
 */
export function verifyFieldExists(
  schemaResult: SchemaChangeVerificationResult,
  fieldName: string,
): { pass: boolean; detail: string } {
  const fieldResult = schemaResult.fieldResults.find((f) => f.field === fieldName);

  if (!fieldResult) {
    return {
      pass: false,
      detail: `字段 '${fieldName}' 不在验证范围内（未在 expectedFields 中声明）`,
    };
  }

  const { dbPresent, matviewPresent, ontologyPresent } = fieldResult;

  // All three layers must have the field
  if (dbPresent && matviewPresent && ontologyPresent) {
    return {
      pass: true,
      detail: `字段 '${fieldName}' 已在三层全部存在（DB ✓ / Matview ✓ / Ontology ✓）`,
    };
  }

  // Build diagnostic detail showing which layers are missing
  const missing: string[] = [];
  if (!dbPresent) missing.push('DB');
  if (!matviewPresent) missing.push('Matview');
  if (!ontologyPresent) missing.push('Ontology');

  return {
    pass: false,
    detail: `字段 '${fieldName}' 缺失于：${missing.join('、')}`,
  };
}

/**
 * Verify that a field has been backfilled with non-NULL values in the database.
 *
 * Use after adding a derived field and running backfill to confirm the field
 * actually contains data (not just NULL columns). The "ADR-0059 live tenant
 * downsink" memory page describes the blindspot this catches.
 *
 * Queries the object_instances.properties JSONB column for the specified field.
 *
 * @param prisma - Prisma service instance
 * @param tenantId - Tenant ID owning the object
 * @param objectTypeName - Object type name (e.g. 'rice_cooker_sales')
 * @param fieldName - Field to check for non-NULL values in properties JSONB
 * @param minRows - Minimum non-NULL row count expected (default: 1)
 * @returns Verdict with pass=true if non-NULL count >= minRows
 */
export async function verifyFieldBackfilled(
  prisma: PrismaService,
  tenantId: string,
  objectTypeName: string,
  fieldName: string,
  minRows: number = 1,
): Promise<{ pass: boolean; detail: string }> {
  // Verify object type exists
  const ot = await prisma.objectType.findFirst({
    where: {
      tenantId,
      name: objectTypeName,
    },
    select: {
      id: true,
    },
  });

  if (!ot) {
    return {
      pass: false,
      detail: `对象类型 '${objectTypeName}' 不存在于租户 ${tenantId}`,
    };
  }

  // Count non-NULL values for the field in object_instances.properties
  // Query pattern: properties->>fieldName IS NOT NULL
  const result = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `
    SELECT COUNT(*) as count
    FROM object_instances
    WHERE tenant_id = $1::uuid
      AND object_type = $2
      AND deleted_at IS NULL
      AND properties->>$3 IS NOT NULL
    `,
    tenantId,
    objectTypeName,
    fieldName,
  );

  const actualCount = Number(result[0]?.count ?? 0);

  if (actualCount >= minRows) {
    return {
      pass: true,
      detail: `字段 '${fieldName}' 已回填：${actualCount} 行非 NULL（≥ ${minRows}）`,
    };
  }

  return {
    pass: false,
    detail: `字段 '${fieldName}' 回填不足：${actualCount} 行非 NULL（需要 ≥ ${minRows}）`,
  };
}

/**
 * Verify dimension constraint configuration (required/default settings).
 *
 * Use to confirm ADR-0057 dimension constraints were applied correctly.
 * Checks the ObjectType.dimensions JSON structure for a specific dimension.
 *
 * Context: ADR-0057 introduced required/defaulted dimensions to prevent
 * multi-period ambiguity. ADR-0060 added the "dimension default blindspot"
 * lesson: a defaulted dimension makes the Agent blind to it unless skill
 * prose explicitly tells the Agent the dimension exists.
 *
 * @param objectType - ObjectType record with dimensions JSON
 * @param dimensionName - Dimension to check (e.g. 'priceBand')
 * @param expectedRequired - Whether the dimension should be required (true/false)
 * @param expectedDefault - Expected default value (e.g. '整体'), or null if no default
 * @returns Verdict with pass=true if constraints match expectations
 */
export function verifyDimensionConstraint(
  objectType: { dimensions: unknown },
  dimensionName: string,
  expectedRequired: boolean,
  expectedDefault: string | null,
): { pass: boolean; detail: string } {
  // Parse dimensions JSON
  const dimensions =
    typeof objectType.dimensions === 'object' && objectType.dimensions !== null
      ? (objectType.dimensions as Record<string, unknown>)
      : {};

  const dimension = dimensions[dimensionName];

  if (!dimension || typeof dimension !== 'object') {
    return {
      pass: false,
      detail: `维度 '${dimensionName}' 不存在于 ObjectType.dimensions 配置中`,
    };
  }

  const dimConfig = dimension as Record<string, unknown>;

  // Check required flag
  const actualRequired = dimConfig.required === true;
  if (actualRequired !== expectedRequired) {
    return {
      pass: false,
      detail: `维度 '${dimensionName}' 的 required 配置错误：期望 ${expectedRequired}，实际 ${actualRequired}`,
    };
  }

  // Check default value
  const actualDefault = dimConfig.default !== undefined ? String(dimConfig.default) : null;
  if (actualDefault !== expectedDefault) {
    const expectedStr = expectedDefault === null ? 'null（无默认值）' : `'${expectedDefault}'`;
    const actualStr = actualDefault === null ? 'null（无默认值）' : `'${actualDefault}'`;
    return {
      pass: false,
      detail: `维度 '${dimensionName}' 的 default 配置错误：期望 ${expectedStr}，实际 ${actualStr}`,
    };
  }

  // All checks passed
  const requiredStr = expectedRequired ? '必需' : '可选';
  const defaultStr = expectedDefault === null ? '无默认值' : `默认值 '${expectedDefault}'`;
  return {
    pass: true,
    detail: `维度 '${dimensionName}' 约束正确：${requiredStr}，${defaultStr}`,
  };
}

// ============================================================================
// UNIT TEST EXAMPLES
// ============================================================================

/**
 * Example 1: Tolerance edge cases in compareNumeric
 *
 * Demonstrates the 0.5% default relative tolerance and how to override it.
 */
export function example1_ToleranceEdgeCases() {
  const { compareNumeric } = require('../delivery-report/verdict');

  // Case 1: Within default tolerance (0.5%)
  const case1 = compareNumeric({
    groundTruth: 100000,
    actual: 100400, // 0.4% error
  });
  console.assert(case1.pass === true, 'Should pass within default tolerance');

  // Case 2: Just outside default tolerance
  const case2 = compareNumeric({
    groundTruth: 100000,
    actual: 100600, // 0.6% error
  });
  console.assert(case2.pass === false, 'Should fail outside default tolerance');

  // Case 3: Custom tolerance for coarse rounding
  const case3 = compareNumeric({
    groundTruth: 28612345,
    actual: 28600000, // Rounded to "2860万", ~0.04% error
    relTolerance: 0.01, // 1% tolerance
  });
  console.assert(case3.pass === true, 'Should pass with custom tolerance');

  // Case 4: Zero ground truth edge case
  const case4 = compareNumeric({
    groundTruth: 0,
    actual: 0.001, // Tiny absolute error
  });
  // Uses denominator = 1 when groundTruth is 0, so relErr = 0.001
  console.assert(case4.pass === true, 'Should handle zero ground truth');

  // Case 5: Missing actual value
  const case5 = compareNumeric({
    groundTruth: 100000,
    actual: null,
  });
  console.assert(case5.pass === false, 'Should fail when actual is null');
  console.assert(
    case5.detail.includes('未取到数值'),
    'Should report missing value',
  );
}

/**
 * Example 2: Ranking ties and order-insensitive comparison
 *
 * Demonstrates set equality (default) vs strict ordering for TOP-N scenarios.
 */
export function example2_RankingTies() {
  const { compareRanking } = require('../delivery-report/verdict');

  // Case 1: Set equality (order-insensitive) - default behavior
  const case1 = compareRanking({
    groundTruth: ['美的', '九阳', '苏泊尔', '小米', '米家'],
    actual: ['小米', '美的', '米家', '九阳', '苏泊尔'], // Reordered
    requireOrder: false,
  });
  console.assert(case1.pass === true, 'Should pass with correct set (order-insensitive)');

  // Case 2: Strict ordering
  const case2 = compareRanking({
    groundTruth: ['美的', '九阳', '苏泊尔'],
    actual: ['九阳', '美的', '苏泊尔'], // Wrong order
    requireOrder: true,
  });
  console.assert(case2.pass === false, 'Should fail when order is wrong');

  // Case 3: Missing brand (fabricated brand)
  const case3 = compareRanking({
    groundTruth: ['美的', '九阳', '苏泊尔'],
    actual: ['美的', '九阳', '松下'], // 松下 not in ground truth
    requireOrder: false,
  });
  console.assert(case3.pass === false, 'Should fail with fabricated brand');
  console.assert(
    case3.detail.includes('多出/编造'),
    'Should report fabricated item',
  );

  // Case 4: Whitespace normalization
  const case4 = compareRanking({
    groundTruth: ['美的', '九阳', '苏泊尔'],
    actual: ['美的 ', ' 九阳', '苏泊尔'], // Extra whitespace
    requireOrder: false,
  });
  console.assert(case4.pass === true, 'Should normalize whitespace');

  // Case 5: Ties with order requirement - practical example
  // When two brands have identical market share (e.g. 12.34%), their order
  // in the ground truth is arbitrary. Set equality avoids false negatives.
  const case5 = compareRanking({
    groundTruth: ['美的', '九阳', '苏泊尔'], // Share: 30%, 12.34%, 12.34%
    actual: ['美的', '苏泊尔', '九阳'], // Flipped tied brands
    requireOrder: false, // ✓ Correct: treats as set
  });
  console.assert(case5.pass === true, 'Should handle ties with set equality');

  const case5b = compareRanking({
    groundTruth: ['美的', '九阳', '苏泊尔'],
    actual: ['美的', '苏泊尔', '九阳'],
    requireOrder: true, // ✗ Would falsely fail on tied brands
  });
  console.assert(case5b.pass === false, 'Strict order fails on ties (expected)');
}

/**
 * Example 3: Chinese magnitude parsing (万/亿) in checkTextConsistency
 *
 * Demonstrates how the text consistency checker parses Chinese-formatted
 * numbers with万 (10^4) and 亿 (10^8) multipliers, plus comma-separated
 * integers, and handles the "unit-in-DB" case where the DB value already
 * stores the displayed unit.
 */
export function example3_ChineseMagnitudeParsing() {
  const { checkTextConsistency } = require('../delivery-report/verdict');

  // Case 1: 万 multiplier (10^4)
  const case1 = checkTextConsistency({
    text: '2024年纯米品牌零售额约为 2861 万元',
    groundTruth: 28612345, // Actual value in DB
    relTolerance: 0.03, // 3% tolerance for prose rounding
  });
  console.assert(case1.pass === true, 'Should parse 2861万 → 28,610,000');

  // Case 2: 亿 multiplier (10^8)
  const case2 = checkTextConsistency({
    text: '全市场规模达到 12.5 亿元',
    groundTruth: 1250000000,
  });
  console.assert(case2.pass === true, 'Should parse 12.5亿 → 1,250,000,000');

  // Case 3: Comma-separated integer
  const case3 = checkTextConsistency({
    text: '销量为 28,612,345 台',
    groundTruth: 28612345,
  });
  console.assert(case3.pass === true, 'Should parse comma-separated number');

  // Case 4: Unit-in-DB case (DB stores 24269 representing "24269万元")
  // The parser emits BOTH 24269 * 10^4 AND 24269 to handle this
  const case4 = checkTextConsistency({
    text: '零售额为 24,269 万元',
    groundTruth: 24269, // DB value already in 万 units
  });
  console.assert(case4.pass === true, 'Should handle unit-in-DB case');

  // Case 5: Multiple numbers in text - takes closest match
  const case5 = checkTextConsistency({
    text: '美的占 30.5%，九阳占 2861 万元零售额',
    groundTruth: 28612345,
  });
  console.assert(
    case5.pass === true,
    'Should find best match among multiple numbers',
  );

  // Case 6: No parseable numbers - fail-soft
  const case6 = checkTextConsistency({
    text: '数据不足，无法提供具体数值',
    groundTruth: 28612345,
  });
  console.assert(case6.pass === false, 'Should fail when no numbers present');
  console.assert(
    case6.detail.includes('未出现可比对的数值'),
    'Should report no numbers',
  );

  // Case 7: Coarse rounding tolerance
  const case7 = checkTextConsistency({
    text: '约 2900 万元', // Coarsely rounded
    groundTruth: 28612345,
    relTolerance: 0.03, // 3% tolerance (default for text consistency)
  });
  // 2900万 = 29,000,000, error = (29M - 28.61M) / 28.61M ≈ 1.4% < 3%
  console.assert(case7.pass === true, 'Should tolerate coarse rounding in prose');
}

/**
 * Example 4: Dimension constraint verification (ADR-0057)
 *
 * Demonstrates how to verify required/default dimension configuration.
 */
export function example4_DimensionConstraints() {
  // Mock ObjectType with dimension config
  const mockObjectType = {
    dimensions: {
      priceBand: {
        required: false,
        default: '整体',
      },
      period: {
        required: true,
        default: null,
      },
      channel: {
        required: false,
      },
    },
  };

  // Case 1: Correct optional dimension with default
  const case1 = verifyDimensionConstraint(
    mockObjectType,
    'priceBand',
    false, // expectedRequired
    '整体', // expectedDefault
  );
  console.assert(case1.pass === true, 'Should pass with correct config');
  console.assert(
    case1.detail.includes('可选') && case1.detail.includes('默认值'),
    'Should describe config in detail',
  );

  // Case 2: Correct required dimension with no default
  const case2 = verifyDimensionConstraint(
    mockObjectType,
    'period',
    true, // expectedRequired
    null, // expectedDefault
  );
  console.assert(case2.pass === true, 'Should pass for required dimension');

  // Case 3: Wrong required flag
  const case3 = verifyDimensionConstraint(
    mockObjectType,
    'priceBand',
    true, // Expected required=true, but actual is false
    '整体',
  );
  console.assert(case3.pass === false, 'Should fail when required flag wrong');
  console.assert(case3.detail.includes('required'), 'Should report required mismatch');

  // Case 4: Wrong default value
  const case4 = verifyDimensionConstraint(
    mockObjectType,
    'priceBand',
    false,
    '低端', // Expected '低端', but actual is '整体'
  );
  console.assert(case4.pass === false, 'Should fail when default value wrong');
  console.assert(case4.detail.includes('default'), 'Should report default mismatch');

  // Case 5: Missing dimension
  const case5 = verifyDimensionConstraint(
    mockObjectType,
    'nonexistent',
    false,
    null,
  );
  console.assert(case5.pass === false, 'Should fail for missing dimension');
  console.assert(case5.detail.includes('不存在'), 'Should report missing dimension');

  // Case 6: Dimension with no default (undefined vs null)
  const case6 = verifyDimensionConstraint(
    mockObjectType,
    'channel', // Has no 'default' key at all
    false,
    null, // Expect no default
  );
  console.assert(case6.pass === true, 'Should handle missing default key as null');
}
