import { classifyProvenance, mapColumnType } from './provenance-classifier';
import type { Cardinality } from './ontology';
import {
  ONTOLOGY_SNAPSHOT_VERSION,
  type OntologySnapshot,
  type SnapshotObjectType,
  type SnapshotProperty,
  type SnapshotRelationship,
} from './ontology-snapshot';

/** Plain, DB-agnostic metadata shape the assembler consumes (mirrors DbIntrospectionService). */
export interface ReverseInferenceColumn {
  name: string;
  dbType: string;
  nullable: boolean;
}
export interface ReverseInferenceForeignKey {
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
}
export interface ReverseInferenceUniqueIndex {
  table: string;
  column: string;
}
/** Sampled distinct values for a column, used to infer allowedValues (#74). */
export interface ReverseInferenceSample {
  table: string;
  column: string;
  distinctValues: string[];
  /** True when the distinct scan hit its cap (so the value set may be incomplete). */
  truncated: boolean;
}
export interface ReverseInferenceInput {
  tables: string[];
  columnsByTable: Record<string, ReverseInferenceColumn[]>;
  foreignKeys: ReverseInferenceForeignKey[];
  uniqueIndexes: ReverseInferenceUniqueIndex[];
  /** Optional distinct-value samples for low-cardinality string columns (#74). */
  samples?: ReverseInferenceSample[];
}

/** Max distinct values for a string column to be treated as a controlled value set (#74). */
export const ALLOWED_VALUES_CARDINALITY_CAP = 12;

/**
 * Assemble a provenance-tagged ontology snapshot from database metadata (ADR-0032). Pure,
 * so the structural inference is unit-testable without a live DB. Every element is tagged:
 * column types and FK relationships are `metadata` (hard); unique columns are `candidate`
 * externalId keys. Naming-only relationships are NOT inferred here — they'd be `heuristic`,
 * and the ADR scopes DB reverse-inference to FK-backed relationships only (file path stays
 * single-table). Semantic annotation (description/unit) is added later by the LLM and is
 * always `heuristic`.
 */
export function assembleSnapshotFromDbMetadata(input: ReverseInferenceInput): OntologySnapshot {
  const typeProvenance = classifyProvenance({ kind: 'declared-type' });

  const uniqueByTable = new Map<string, string[]>();
  for (const u of input.uniqueIndexes) {
    const list = uniqueByTable.get(u.table) ?? [];
    list.push(u.column);
    uniqueByTable.set(u.table, list);
  }

  // Columns that back a FK become the relationship pointer; exclude them from plain props
  // so the ontology doesn't carry a raw `xxx_id` alongside the relationship.
  const fkSourceColumns = new Set(input.foreignKeys.map((fk) => `${fk.sourceTable}::${fk.sourceColumn}`));

  const sampleByKey = new Map<string, ReverseInferenceSample>();
  for (const s of input.samples ?? []) sampleByKey.set(`${s.table}::${s.column}`, s);

  const objectTypes: SnapshotObjectType[] = input.tables.map((table) => {
    const columns = input.columnsByTable[table] ?? [];
    const properties: SnapshotProperty[] = columns
      .filter((c) => !fkSourceColumns.has(`${table}::${c.name}`))
      .map((c) => {
        const type = mapColumnType(c.dbType);
        const prop: SnapshotProperty = {
          name: c.name,
          label: c.name,
          type,
          ...(c.nullable ? {} : { required: true }),
          provenance: classifyProvenance({ kind: 'declared-type' }),
        };
        // allowedValues from a low-cardinality, fully-scanned string column (#74).
        // Heuristic + red-flag: the OPC must confirm "is this the COMPLETE legal set?"
        // — a sample of N distinct values is not proof the business has only N.
        const sample = sampleByKey.get(`${table}::${c.name}`);
        if (
          type === 'string' &&
          sample &&
          !sample.truncated &&
          sample.distinctValues.length > 0 &&
          sample.distinctValues.length <= ALLOWED_VALUES_CARDINALITY_CAP
        ) {
          prop.allowedValues = dedupeStrings(sample.distinctValues);
          prop.allowedValuesUnconfirmed = true;
          prop.filterable = true; // a controlled value set is a natural filter dimension
          prop.provenance = classifyProvenance({ kind: 'sampled-allowed-values' });
        }
        return prop;
      });

    const externalIdCandidates = (uniqueByTable.get(table) ?? []).filter(
      (col) => !fkSourceColumns.has(`${table}::${col}`),
    );

    const type: SnapshotObjectType = {
      name: table,
      label: table,
      properties,
      derivedProperties: [],
      provenance: typeProvenance,
    };
    if (externalIdCandidates.length > 0) type.externalIdCandidates = externalIdCandidates;
    return type;
  });

  const tableSet = new Set(input.tables);
  const relationships: SnapshotRelationship[] = [];
  const usedRelKeys = new Set<string>();
  for (const fk of input.foreignKeys) {
    if (!tableSet.has(fk.sourceTable) || !tableSet.has(fk.targetTable)) continue;
    const rel = relationshipFromFk(fk);
    // Two FKs between the same table pair (e.g. source/target columns on one table)
    // would collide on name; disambiguate with the source column so each FK is its own
    // relationship and the snapshot stays valid.
    let key = `${rel.sourceType}::${rel.name}`;
    if (usedRelKeys.has(key)) {
      rel.name = `${rel.name}_via_${fk.sourceColumn}`;
      key = `${rel.sourceType}::${rel.name}`;
    }
    usedRelKeys.add(key);
    relationships.push(rel);
  }

  return { version: ONTOLOGY_SNAPSHOT_VERSION, objectTypes, relationships };
}

/**
 * A FK A.col → B.col means "many A belong to one B". We model the relationship from the
 * ONE side (target B) to the MANY side (source A) as one-to-many, backed by metadata.
 */
function relationshipFromFk(fk: ReverseInferenceForeignKey): SnapshotRelationship {
  const cardinality: Cardinality = 'one-to-many';
  return {
    name: `${fk.targetTable}_${fk.sourceTable}`,
    sourceType: fk.targetTable,
    targetType: fk.sourceTable,
    cardinality,
    description: `由外键 ${fk.sourceTable}.${fk.sourceColumn} → ${fk.targetTable}.${fk.targetColumn} 推断`,
    provenance: classifyProvenance({ kind: 'fk-relationship' }),
  };
}

/**
 * Merge a freshly inferred snapshot into an existing draft snapshot (#74: incremental
 * re-entry). Existing object types and relationships are preserved (the OPC's edits win);
 * only genuinely new types/relationships from the inference are appended. Pure.
 */
export function mergeSnapshots(existing: OntologySnapshot, incoming: OntologySnapshot): OntologySnapshot {
  const existingTypeNames = new Set(existing.objectTypes.map((t) => t.name));
  const mergedTypes = [
    ...existing.objectTypes,
    ...incoming.objectTypes.filter((t) => !existingTypeNames.has(t.name)),
  ];

  const relKey = (r: SnapshotRelationship) => `${r.sourceType}::${r.name}`;
  const existingRelKeys = new Set(existing.relationships.map(relKey));
  const mergedRels = [
    ...existing.relationships,
    ...incoming.relationships.filter((r) => !existingRelKeys.has(relKey(r))),
  ];

  return { version: ONTOLOGY_SNAPSHOT_VERSION, objectTypes: mergedTypes, relationships: mergedRels };
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = String(v).trim();
    if (t !== '' && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}
