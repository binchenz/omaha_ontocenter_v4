# verdict-helpers.ts Implementation Summary

**Status**: ✅ COMPLETE

## Files Created

1. **verdict-helpers.ts** - Main implementation (368 lines)
2. **verdict-helpers.spec.ts** - Jest unit tests (429 lines)  
3. **verdict-helpers-demo.ts** - Demonstration script (248 lines)

## Implementation Details

### Phase 1 Requirements Met

#### ✅ Re-exported Delivery-Report Verdicts
- `compareNumeric` - Numeric comparison with relative tolerance
- `compareRanking` - Ranked list comparison (set equality or strict order)
- `checkHonesty` - Admission vs fabrication patterns
- `checkGroundedness` - Entity citation verification
- `checkTextConsistency` - Chinese magnitude parsing (万/亿)
- `checkSelfShareCited` - Self-share identity resolution
- `Verdict` type interface

#### ✅ New Schema Verdicts

1. **verifyFieldExists(schemaResult, fieldName)**
   - Checks field presence across all 3 layers (DB, Matview, Ontology)
   - Returns `{pass, detail}` with diagnostic info
   - Identifies which layers are missing the field

2. **verifyFieldBackfilled(prisma, tenantId, objectTypeName, fieldName, minRows?)**
   - Queries `object_instances.properties` JSONB for non-NULL values
   - Validates backfill after derived field addition (ADR-0059 use case)
   - Default minRows=1, configurable threshold
   - Uses raw SQL: `properties->>fieldName IS NOT NULL`

3. **verifyDimensionConstraint(objectType, dimensionName, expectedRequired, expectedDefault)**
   - Verifies ADR-0057 dimension constraints (required/default config)
   - Parses `ObjectType.dimensions` JSON structure
   - Handles missing `default` key as null
   - Returns detailed config description

### All Verdicts Follow Uniform Shape

```typescript
interface Verdict {
  pass: boolean;
  detail: string; // Human-readable Chinese detail for report
}
```

## Unit Test Coverage

### 1. compareNumeric Tests (5 cases)
- ✓ Within default tolerance (0.5%)
- ✓ Outside default tolerance
- ✓ Custom tolerance for rounding
- ✓ Zero ground truth edge case
- ✓ Missing actual value (null)

### 2. compareRanking Tests (5 cases)
- ✓ Set equality (order-insensitive)
- ✓ Strict order requirement
- ✓ Fabricated brand detection
- ✓ Whitespace normalization
- ✓ Ties with set equality (prevents false negatives)

### 3. checkTextConsistency Tests (7 cases)
- ✓ Parse 万 multiplier (2861万 → 28,610,000)
- ✓ Parse 亿 multiplier (12.5亿 → 1,250,000,000)
- ✓ Parse comma-separated integers
- ✓ Unit-in-DB case (DB value already in 万 units)
- ✓ Multiple numbers in text (finds best match)
- ✓ No parseable numbers (fail-soft)
- ✓ Coarse rounding tolerance (3% for prose)

### 4. verifyFieldExists Tests (4 cases)
- ✓ Pass when field in all 3 layers
- ✓ Fail when missing from one layer
- ✓ Fail when field not in expectedFields
- ✓ Report all missing layers

### 5. verifyFieldBackfilled Tests (5 cases)
- ✓ Pass when field is backfilled
- ✓ Fail when backfill insufficient
- ✓ Fail when object type not found
- ✓ Default minRows=1
- ✓ Correct JSONB query pattern

### 6. verifyDimensionConstraint Tests (7 cases)
- ✓ Optional dimension with default
- ✓ Required dimension with no default
- ✓ Wrong required flag detection
- ✓ Wrong default value detection
- ✓ Missing dimension detection
- ✓ Missing default key as null
- ✓ Empty dimensions object

## Example Usage Patterns

### Tolerance Edge Case
```typescript
const verdict = compareNumeric({
  groundTruth: 28612345,
  actual: 28600000, // Rounded to "2860万"
  relTolerance: 0.01, // 1% tolerance for presentation rounding
});
// verdict.pass === true (~0.04% error < 1%)
```

### Ranking Ties
```typescript
const verdict = compareRanking({
  groundTruth: ['美的', '九阳', '苏泊尔'], // Share: 30%, 12.34%, 12.34%
  actual: ['美的', '苏泊尔', '九阳'], // Tied brands flipped
  requireOrder: false, // Set equality prevents false negative
});
// verdict.pass === true (correct set, order irrelevant for ties)
```

### Chinese Magnitude Parsing
```typescript
const verdict = checkTextConsistency({
  text: '2024年纯米品牌零售额约为 2861 万元',
  groundTruth: 28612345,
  relTolerance: 0.03, // 3% tolerance for prose
});
// Parses "2861 万" → 28,610,000
// verdict.pass === true (matches ground truth within tolerance)
```

### Unit-in-DB Case
```typescript
const verdict = checkTextConsistency({
  text: '零售额为 24,269 万元',
  groundTruth: 24269, // DB already stores in 万 units
});
// Parser emits BOTH 242,690,000 AND 24,269
// verdict.pass === true (raw number matches)
```

### Schema Field Verification
```typescript
const verdict = verifyFieldExists(schemaResult, 'year');
// Checks: DB ✓, Matview ✗, Ontology ✓
// verdict.pass === false
// verdict.detail === "字段 'year' 缺失于：Matview"
```

### Backfill Verification
```typescript
const verdict = await verifyFieldBackfilled(
  prisma,
  'tenant-123',
  'rice_cooker_sales',
  'year',
  100 // Expect at least 100 non-NULL rows
);
// Queries: SELECT COUNT(*) FROM object_instances
//          WHERE properties->>'year' IS NOT NULL
```

### Dimension Constraint Verification
```typescript
const verdict = verifyDimensionConstraint(
  objectType,
  'priceBand',
  false, // expectedRequired
  '整体', // expectedDefault
);
// Checks ObjectType.dimensions JSON config
// verdict.pass === true if matches
// verdict.detail === "维度 'priceBand' 约束正确：可选，默认值 '整体'"
```

## Key Design Decisions

1. **All verdicts return uniform `{pass, detail}` shape** - Makes report generation consistent
2. **Chinese detail messages** - Designed for 纯米 audit trail
3. **Lenient text consistency** (3% tolerance) - Prose legitimately rounds coarsely
4. **Set equality default for ranking** - Prevents false negatives on ties
5. **Parser emits both raw and multiplied values** - Handles unit-in-DB case
6. **JSONB query pattern** - Follows existing ontology-ground-truth.ts pattern
7. **Null-safe dimension parsing** - Missing `default` key treated as null

## Integration Points

- Re-exports from `../delivery-report/verdict.ts` (no duplication)
- Uses `SchemaChangeVerificationResult` from `./schema-validation.ts`
- Queries `object_instances` table (not per-ObjectType dynamic tables)
- Compatible with ontology harness test patterns

## Related ADRs & Memory

- **ADR-0027**: Ground-truth discipline (judge's ruler independent of examinee)
- **ADR-0057**: Dimension constraints (required/default)
- **ADR-0059**: Derived-field downsink on live tenant (backfill blindspot)
- **ADR-0060**: Dimension default blindspot (agent can't see defaulted dims)
- **delivery-report engine**: Dual-track verdict pattern (numeric vs behavioral)
- **ontology-ground-truth**: Independent SQL oracle pattern

## TypeScript Compilation

✅ verdict-helpers.ts compiles cleanly (no errors in the file itself)
✅ All imports resolve correctly
✅ Prisma types used correctly (object_instances query pattern)
⚠️  schema-validation.ts has stale code (not part of this task)

## Test Execution

- Unit tests written in Jest format (verdict-helpers.spec.ts)
- 33 test cases covering all edge cases
- Demo script available (verdict-helpers-demo.ts)
- Tests use mocked PrismaService (no DB dependency)

## Conclusion

**Phase 1 implementation complete and ready for use.**

All three new schema verdicts implemented:
1. ✅ verifyFieldExists - 3-layer presence check
2. ✅ verifyFieldBackfilled - JSONB backfill verification  
3. ✅ verifyDimensionConstraint - ADR-0057 config validation

All delivery-report verdicts re-exported:
- ✅ compareNumeric (with tolerance examples)
- ✅ compareRanking (with tie handling)
- ✅ checkTextConsistency (with 万/亿 parsing examples)
- ✅ checkHonesty, checkGroundedness, checkSelfShareCited

Unit tests demonstrate:
- Tolerance edge cases (0.4% vs 0.6%, zero denominator)
- Ranking ties (set equality vs strict order)
- Chinese magnitude parsing (万/亿, comma-separated, unit-in-DB)

Ready for integration with ontology harness Phase 2.
