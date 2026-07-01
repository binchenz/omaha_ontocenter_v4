import { PrismaService, DataSourceType } from '@omaha/db';

/**
 * A single field's expected characteristics after a schema change.
 */
export interface FieldExpectation {
  /** Column name in the database / property name in ontology */
  name: string;
  /** PostgreSQL type (e.g. 'text', 'double precision', 'timestamp with time zone') */
  dbType?: string;
  /** Whether the column is nullable in the database */
  nullable?: boolean;
  /** Whether this is a dimension (for ontology layer) */
  isDimension?: boolean;
  /** Whether this is a metric (for ontology layer) */
  isMetric?: boolean;
}

/**
 * Ground truth specification for a schema change verification.
 */
export interface SchemaChangeGroundTruth {
  /** Tenant ID owning the object type */
  tenantId: string;
  /** Object type external ID (e.g. 'rice_cooker_sales') */
  objectTypeExternalId: string;
  /** Expected fields after the change */
  expectedFields: FieldExpectation[];
}

/**
 * Result of checking a single layer.
 */
export interface LayerCheckResult {
  /** Layer name for reporting */
  layer: 'DB' | 'Matview' | 'OntologyView';
  /** Whether all expectations were met */
  passed: boolean;
  /** Fields that were expected but not found */
  missingFields: string[];
  /** Fields with type mismatches (lenient mode ignores these) */
  typeMismatches: Array<{
    field: string;
    expected: string;
    actual: string;
  }>;
  /** Fields with nullability mismatches (lenient mode ignores these) */
  nullabilityMismatches: Array<{
    field: string;
    expectedNullable: boolean;
    actualNullable: boolean;
  }>;
  /** Fields present in the layer but not in expectations (ghost fields) */
  ghostFields: string[];
  /** Additional context about the check */
  metadata?: Record<string, unknown>;
}

/**
 * Result of a single field verification.
 */
export interface FieldVerificationResult {
  field: string;
  dbPresent: boolean;
  matviewPresent: boolean;
  ontologyPresent: boolean;
  dbType?: string;
  matviewType?: string;
  ontologyType?: string;
  issues: string[];
}

/**
 * Complete schema change verification result.
 */
export interface SchemaChangeVerificationResult {
  /** Overall pass/fail */
  passed: boolean;
  /** Per-layer check results */
  layers: {
    db: LayerCheckResult;
    matview: LayerCheckResult;
    ontology: LayerCheckResult;
  };
  /** Per-field verification details */
  fieldResults: FieldVerificationResult[];
  /** Human-readable summary */
  summary: string;
}

/**
 * Configuration options for schema verification.
 */
export interface SchemaVerificationConfig {
  /** If true, only check field existence, not types or nullability */
  lenientMode?: boolean;
  /** If true, skip materialized view checks (for pre-sync scenarios) */
  skipMatview?: boolean;
  /** Prisma service instance (required) */
  prisma: PrismaService;
}

/**
 * Internal metadata about an object type.
 */
interface ObjectTypeMetadata {
  objectTypeId: string;
  tableName: string;
  matviewName: string;
}

/**
 * Resolve object type metadata from the database.
 */
async function resolveObjectTypeMetadata(
  prisma: PrismaService,
  tenantId: string,
  objectTypeExternalId: string,
): Promise<ObjectTypeMetadata> {
  const objectType = await prisma.objectType.findFirst({
    where: {
      tenantId,
      externalId: objectTypeExternalId,
      deletedAt: null,
    },
    select: {
      id: true,
      tableName: true,
    },
  });

  if (!objectType) {
    throw new Error(
      `ObjectType not found: tenantId=${tenantId}, externalId=${objectTypeExternalId}`,
    );
  }

  const matviewName = `${objectType.tableName}_ontology`;

  return {
    objectTypeId: objectType.id,
    tableName: objectType.tableName,
    matviewName,
  };
}

/**
 * Check Layer 1: Raw database table columns.
 */
async function checkLayer1_DB(
  prisma: PrismaService,
  tableName: string,
  expectations: FieldExpectation[],
  lenientMode: boolean,
): Promise<LayerCheckResult> {
  // Query information_schema for the table's columns
  const columns = await prisma.$queryRawUnsafe<
    Array<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      udt_name: string;
    }>
  >(
    `
    SELECT column_name, data_type, is_nullable, udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
    ORDER BY ordinal_position
  `,
    tableName,
  );

  const actualFields = new Map(
    columns.map((col) => [
      col.column_name,
      {
        type: col.data_type === 'USER-DEFINED' ? col.udt_name : col.data_type,
        nullable: col.is_nullable === 'YES',
      },
    ]),
  );

  const missingFields: string[] = [];
  const typeMismatches: Array<{
    field: string;
    expected: string;
    actual: string;
  }> = [];
  const nullabilityMismatches: Array<{
    field: string;
    expectedNullable: boolean;
    actualNullable: boolean;
  }> = [];

  for (const exp of expectations) {
    const actual = actualFields.get(exp.name);

    if (!actual) {
      missingFields.push(exp.name);
      continue;
    }

    // In strict mode, verify types and nullability
    if (!lenientMode) {
      if (exp.dbType && normalizeDbType(actual.type) !== normalizeDbType(exp.dbType)) {
        typeMismatches.push({
          field: exp.name,
          expected: exp.dbType,
          actual: actual.type,
        });
      }

      if (exp.nullable !== undefined && actual.nullable !== exp.nullable) {
        nullabilityMismatches.push({
          field: exp.name,
          expectedNullable: exp.nullable,
          actualNullable: actual.nullable,
        });
      }
    }
  }

  const ghostFields = detectGhostFields(
    Array.from(actualFields.keys()),
    expectations.map((e) => e.name),
  );

  const passed =
    missingFields.length === 0 &&
    typeMismatches.length === 0 &&
    nullabilityMismatches.length === 0;

  return {
    layer: 'DB',
    passed,
    missingFields,
    typeMismatches,
    nullabilityMismatches,
    ghostFields,
    metadata: { tableName },
  };
}

/**
 * Check Layer 2: Materialized view columns.
 */
async function checkLayer2_Matview(
  prisma: PrismaService,
  matviewName: string,
  expectations: FieldExpectation[],
  lenientMode: boolean,
): Promise<LayerCheckResult> {
  // Query information_schema for the matview's columns
  const columns = await prisma.$queryRawUnsafe<
    Array<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      udt_name: string;
    }>
  >(
    `
    SELECT column_name, data_type, is_nullable, udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
    ORDER BY ordinal_position
  `,
    matviewName,
  );

  const actualFields = new Map(
    columns.map((col) => [
      col.column_name,
      {
        type: col.data_type === 'USER-DEFINED' ? col.udt_name : col.data_type,
        nullable: col.is_nullable === 'YES',
      },
    ]),
  );

  const missingFields: string[] = [];
  const typeMismatches: Array<{
    field: string;
    expected: string;
    actual: string;
  }> = [];
  const nullabilityMismatches: Array<{
    field: string;
    expectedNullable: boolean;
    actualNullable: boolean;
  }> = [];

  for (const exp of expectations) {
    const actual = actualFields.get(exp.name);

    if (!actual) {
      missingFields.push(exp.name);
      continue;
    }

    // In strict mode, verify types and nullability
    if (!lenientMode) {
      if (exp.dbType && normalizeDbType(actual.type) !== normalizeDbType(exp.dbType)) {
        typeMismatches.push({
          field: exp.name,
          expected: exp.dbType,
          actual: actual.type,
        });
      }

      if (exp.nullable !== undefined && actual.nullable !== exp.nullable) {
        nullabilityMismatches.push({
          field: exp.name,
          expectedNullable: exp.nullable,
          actualNullable: actual.nullable,
        });
      }
    }
  }

  const ghostFields = detectGhostFields(
    Array.from(actualFields.keys()),
    expectations.map((e) => e.name),
  );

  const passed =
    missingFields.length === 0 &&
    typeMismatches.length === 0 &&
    nullabilityMismatches.length === 0;

  return {
    layer: 'Matview',
    passed,
    missingFields,
    typeMismatches,
    nullabilityMismatches,
    ghostFields,
    metadata: { matviewName },
  };
}

/**
 * Check Layer 3: Ontology view (ObjectType + PropertyDefinition).
 */
async function checkLayer3_Ontology(
  prisma: PrismaService,
  objectTypeId: string,
  expectations: FieldExpectation[],
  lenientMode: boolean,
): Promise<LayerCheckResult> {
  const properties = await prisma.propertyDefinition.findMany({
    where: {
      objectTypeId,
      deletedAt: null,
    },
    select: {
      externalId: true,
      dataType: true,
      sourceType: true,
    },
  });

  const actualFields = new Map(
    properties.map((prop) => [
      prop.externalId,
      {
        dataType: prop.dataType,
        sourceType: prop.sourceType,
      },
    ]),
  );

  const missingFields: string[] = [];
  const typeMismatches: Array<{
    field: string;
    expected: string;
    actual: string;
  }> = [];
  const nullabilityMismatches: Array<{
    field: string;
    expectedNullable: boolean;
    actualNullable: boolean;
  }> = [];

  for (const exp of expectations) {
    const actual = actualFields.get(exp.name);

    if (!actual) {
      missingFields.push(exp.name);
      continue;
    }

    // In strict mode, verify dimension/metric flags via sourceType
    if (!lenientMode) {
      const isDimension = actual.sourceType === DataSourceType.USER_DEFINED_DIMENSION;
      const isMetric = actual.sourceType === DataSourceType.USER_DEFINED_METRIC;

      if (exp.isDimension !== undefined && isDimension !== exp.isDimension) {
        typeMismatches.push({
          field: exp.name,
          expected: exp.isDimension ? 'dimension' : 'not dimension',
          actual: isDimension ? 'dimension' : 'not dimension',
        });
      }

      if (exp.isMetric !== undefined && isMetric !== exp.isMetric) {
        typeMismatches.push({
          field: exp.name,
          expected: exp.isMetric ? 'metric' : 'not metric',
          actual: isMetric ? 'metric' : 'not metric',
        });
      }
    }
  }

  const ghostFields = detectGhostFields(
    Array.from(actualFields.keys()),
    expectations.map((e) => e.name),
  );

  const passed =
    missingFields.length === 0 &&
    typeMismatches.length === 0 &&
    nullabilityMismatches.length === 0;

  return {
    layer: 'OntologyView',
    passed,
    missingFields,
    typeMismatches,
    nullabilityMismatches,
    ghostFields,
    metadata: { objectTypeId },
  };
}

/**
 * Detect fields present in actual but not in expectations.
 */
function detectGhostFields(
  actualFieldNames: string[],
  expectedFieldNames: string[],
): string[] {
  const expectedSet = new Set(expectedFieldNames);
  const systemColumns = new Set([
    'id',
    'tenant_id',
    'created_at',
    'updated_at',
    'deleted_at',
    'created_by',
    'updated_by',
  ]);

  return actualFieldNames.filter(
    (name) => !expectedSet.has(name) && !systemColumns.has(name),
  );
}

/**
 * Normalize database type names for comparison.
 * Handles common aliases and PostgreSQL-specific representations.
 */
function normalizeDbType(type: string): string {
  const normalized = type.toLowerCase().trim();

  // Map common aliases
  const typeMap: Record<string, string> = {
    'character varying': 'varchar',
    'double precision': 'float8',
    'timestamp with time zone': 'timestamptz',
    'timestamp without time zone': 'timestamp',
    'integer': 'int4',
    'bigint': 'int8',
    'smallint': 'int2',
    'boolean': 'bool',
  };

  return typeMap[normalized] || normalized;
}

/**
 * Format a human-readable summary of the verification result.
 */
export function formatVerificationSummary(
  result: SchemaChangeVerificationResult,
): string {
  const lines: string[] = [];

  if (result.passed) {
    lines.push('✅ Schema change verification PASSED');
  } else {
    lines.push('❌ Schema change verification FAILED');
  }

  lines.push('');

  // Layer summaries
  for (const [layerKey, layerResult] of Object.entries(result.layers)) {
    const icon = layerResult.passed ? '✅' : '❌';
    lines.push(`${icon} Layer: ${layerResult.layer}`);

    if (layerResult.missingFields.length > 0) {
      lines.push(`   Missing fields: ${layerResult.missingFields.join(', ')}`);
    }

    if (layerResult.typeMismatches.length > 0) {
      lines.push(`   Type mismatches:`);
      for (const mismatch of layerResult.typeMismatches) {
        lines.push(
          `     - ${mismatch.field}: expected ${mismatch.expected}, got ${mismatch.actual}`,
        );
      }
    }

    if (layerResult.nullabilityMismatches.length > 0) {
      lines.push(`   Nullability mismatches:`);
      for (const mismatch of layerResult.nullabilityMismatches) {
        lines.push(
          `     - ${mismatch.field}: expected nullable=${mismatch.expectedNullable}, got ${mismatch.actualNullable}`,
        );
      }
    }

    if (layerResult.ghostFields.length > 0) {
      lines.push(`   Ghost fields: ${layerResult.ghostFields.join(', ')}`);
    }

    lines.push('');
  }

  // Field-level summary
  const problemFields = result.fieldResults.filter((f) => f.issues.length > 0);
  if (problemFields.length > 0) {
    lines.push('Field-level issues:');
    for (const field of problemFields) {
      lines.push(`  ${field.field}:`);
      for (const issue of field.issues) {
        lines.push(`    - ${issue}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Verify that a schema change has propagated correctly through all three layers:
 * 1. DB (raw table columns)
 * 2. Matview (materialized view columns)
 * 3. OntologyView (ObjectType + PropertyDefinition)
 *
 * Returns structured verification results without throwing on failures.
 *
 * @param groundTruth - Expected schema after the change
 * @param config - Verification configuration
 * @returns Structured verification result with per-layer checks
 */
export async function verifySchemaChange(
  groundTruth: SchemaChangeGroundTruth,
  config: SchemaVerificationConfig,
): Promise<SchemaChangeVerificationResult> {
  const { prisma, lenientMode = false, skipMatview = false } = config;

  // Resolve metadata
  const metadata = await resolveObjectTypeMetadata(
    prisma,
    groundTruth.tenantId,
    groundTruth.objectTypeExternalId,
  );

  // Run layer checks
  const dbResult = await checkLayer1_DB(
    prisma,
    metadata.tableName,
    groundTruth.expectedFields,
    lenientMode,
  );

  const matviewResult = skipMatview
    ? {
        layer: 'Matview' as const,
        passed: true,
        missingFields: [],
        typeMismatches: [],
        nullabilityMismatches: [],
        ghostFields: [],
        metadata: { skipped: true },
      }
    : await checkLayer2_Matview(
        prisma,
        metadata.matviewName,
        groundTruth.expectedFields,
        lenientMode,
      );

  const ontologyResult = await checkLayer3_Ontology(
    prisma,
    metadata.objectTypeId,
    groundTruth.expectedFields,
    lenientMode,
  );

  // Build per-field results
  const fieldResults: FieldVerificationResult[] = groundTruth.expectedFields.map(
    (exp) => {
      const issues: string[] = [];

      const dbPresent = !dbResult.missingFields.includes(exp.name);
      const matviewPresent =
        skipMatview || !matviewResult.missingFields.includes(exp.name);
      const ontologyPresent = !ontologyResult.missingFields.includes(exp.name);

      if (!dbPresent) issues.push('Missing in DB layer');
      if (!matviewPresent) issues.push('Missing in Matview layer');
      if (!ontologyPresent) issues.push('Missing in Ontology layer');

      // Check for type mismatches in each layer
      const dbTypeMismatch = dbResult.typeMismatches.find(
        (m) => m.field === exp.name,
      );
      if (dbTypeMismatch) {
        issues.push(
          `DB type mismatch: expected ${dbTypeMismatch.expected}, got ${dbTypeMismatch.actual}`,
        );
      }

      const matviewTypeMismatch = matviewResult.typeMismatches.find(
        (m) => m.field === exp.name,
      );
      if (matviewTypeMismatch) {
        issues.push(
          `Matview type mismatch: expected ${matviewTypeMismatch.expected}, got ${matviewTypeMismatch.actual}`,
        );
      }

      const ontologyTypeMismatch = ontologyResult.typeMismatches.find(
        (m) => m.field === exp.name,
      );
      if (ontologyTypeMismatch) {
        issues.push(
          `Ontology type mismatch: expected ${ontologyTypeMismatch.expected}, got ${ontologyTypeMismatch.actual}`,
        );
      }

      return {
        field: exp.name,
        dbPresent,
        matviewPresent,
        ontologyPresent,
        issues,
      };
    },
  );

  const passed = dbResult.passed && matviewResult.passed && ontologyResult.passed;

  const result: SchemaChangeVerificationResult = {
    passed,
    layers: {
      db: dbResult,
      matview: matviewResult,
      ontology: ontologyResult,
    },
    fieldResults,
    summary: '', // Will be filled below
  };

  result.summary = formatVerificationSummary(result);

  return result;
}

// ============================================================================
// UNIT TEST EXAMPLES
// ============================================================================

/**
 * Example 1: Strict mode verification after adding a derived field
 *
 * Scenario: Added 'year' field to rice_cooker_sales via ADR-0059
 * Expected: Field exists in all three layers with correct type and nullability
 */
async function example1_StrictModeVerification(prisma: PrismaService) {
  const groundTruth: SchemaChangeGroundTruth = {
    tenantId: '123e4567-e89b-12d3-a456-426614174000',
    objectTypeExternalId: 'rice_cooker_sales',
    expectedFields: [
      {
        name: 'year',
        dbType: 'integer',
        nullable: false,
        isDimension: true,
        isMetric: false,
      },
      {
        name: 'sales_amount',
        dbType: 'double precision',
        nullable: true,
        isDimension: false,
        isMetric: true,
      },
    ],
  };

  const result = await verifySchemaChange(groundTruth, {
    prisma,
    lenientMode: false, // Strict: check types and nullability
    skipMatview: false,
  });

  console.log(result.summary);

  if (!result.passed) {
    throw new Error('Schema verification failed');
  }
}

/**
 * Example 2: Lenient mode for pre-sync verification
 *
 * Scenario: Just added field to DB, matview not yet refreshed
 * Expected: Only check field existence, skip type/nullability checks
 */
async function example2_LenientModePreSync(prisma: PrismaService) {
  const groundTruth: SchemaChangeGroundTruth = {
    tenantId: '123e4567-e89b-12d3-a456-426614174000',
    objectTypeExternalId: 'rice_cooker_sales',
    expectedFields: [
      { name: 'year' },
      { name: 'brand' },
      { name: 'model' },
    ],
  };

  const result = await verifySchemaChange(groundTruth, {
    prisma,
    lenientMode: true, // Only check existence
    skipMatview: true, // Skip matview check (not yet refreshed)
  });

  // In lenient mode with skipMatview, we only verify:
  // 1. DB layer has the columns
  // 2. Ontology layer has the properties
  console.log(result.summary);

  const missingInDb = result.layers.db.missingFields;
  const missingInOntology = result.layers.ontology.missingFields;

  if (missingInDb.length > 0) {
    console.error('Fields missing in DB:', missingInDb);
  }

  if (missingInOntology.length > 0) {
    console.error('Fields missing in Ontology:', missingInOntology);
  }
}

/**
 * Example 3: Detect ghost fields and type mismatches
 *
 * Scenario: Investigating why ObjectMapping dropped columns
 * Expected: Report any unexpected fields or type mismatches
 */
async function example3_DetectAnomalies(prisma: PrismaService) {
  const groundTruth: SchemaChangeGroundTruth = {
    tenantId: '123e4567-e89b-12d3-a456-426614174000',
    objectTypeExternalId: 'rice_cooker_sales',
    expectedFields: [
      { name: 'year', dbType: 'integer', nullable: false },
      { name: 'brand', dbType: 'text', nullable: false },
      { name: 'sales_amount', dbType: 'double precision', nullable: true },
    ],
  };

  const result = await verifySchemaChange(groundTruth, {
    prisma,
    lenientMode: false,
    skipMatview: false,
  });

  // Check for ghost fields (present but not expected)
  for (const [layerName, layerResult] of Object.entries(result.layers)) {
    if (layerResult.ghostFields.length > 0) {
      console.warn(
        `${layerName} has unexpected fields:`,
        layerResult.ghostFields,
      );
    }
  }

  // Check for type mismatches per field
  for (const fieldResult of result.fieldResults) {
    if (fieldResult.issues.length > 0) {
      console.error(`Field '${fieldResult.field}' has issues:`);
      for (const issue of fieldResult.issues) {
        console.error(`  - ${issue}`);
      }
    }
  }

  // Example assertion pattern for test harness
  const yearField = result.fieldResults.find((f) => f.field === 'year');
  if (!yearField?.dbPresent || !yearField?.matviewPresent || !yearField?.ontologyPresent) {
    throw new Error('year field not present in all layers');
  }
}
