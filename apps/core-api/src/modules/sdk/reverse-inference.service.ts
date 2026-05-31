import { Injectable } from '@nestjs/common';
import {
  ALLOWED_VALUES_CARDINALITY_CAP,
  assembleSnapshotFromDbMetadata,
  mapColumnType,
  mergeSnapshots,
  type OntologySnapshot,
  type ReverseInferenceInput,
  type ReverseInferenceSample,
} from '@omaha/shared-types';
import { DbIntrospectionService } from './db-introspection.service';
import { DraftService } from '../ontology/draft.service';

export interface ReverseInferenceResult {
  snapshot: OntologySnapshot;
  stats: { tables: number; relationships: number; merged: boolean };
}

/**
 * Whole-database reverse-inference (ADR-0032): point at a client DB, read its
 * information_schema metadata, and assemble a provenance-tagged draft ontology in one shot.
 * The structural assembly is the pure `assembleSnapshotFromDbMetadata`; this service is the
 * IO shell (read metadata → assemble → seed/merge the Draft). Re-running merges into the
 * existing Draft so client data can be onboarded in waves (#74).
 */
@Injectable()
export class ReverseInferenceService {
  constructor(
    private readonly introspection: DbIntrospectionService,
    private readonly draftService: DraftService,
  ) {}

  /**
   * Infer an ontology snapshot from a DB connection and write it to the tenant's Draft.
   * When `merge` is true and a Draft already exists, the inference is merged into it
   * (existing edits preserved); otherwise it seeds/overwrites the Draft.
   */
  async inferToDraft(
    tenantId: string,
    connectorId: string,
    opts: { merge?: boolean } = {},
  ): Promise<ReverseInferenceResult> {
    const metadata = await this.introspection.readSchemaMetadata(tenantId, connectorId);

    // Sample distinct values for string columns so the assembler can infer (heuristic,
    // red-flagged) allowedValues for low-cardinality fields (#74). FK columns are skipped
    // (they become relationships, not value sets).
    const samples = await this.gatherSamples(tenantId, connectorId, metadata);

    const input: ReverseInferenceInput = {
      tables: metadata.tables,
      columnsByTable: metadata.columnsByTable,
      foreignKeys: metadata.foreignKeys,
      uniqueIndexes: metadata.uniqueIndexes,
      samples,
    };
    const inferred = assembleSnapshotFromDbMetadata(input);

    const existing = opts.merge ? await this.draftService.getDraft(tenantId) : null;
    const snapshot = existing ? mergeSnapshots(existing.snapshot, inferred) : inferred;

    const saved = await this.draftService.upsertSnapshot(tenantId, snapshot);
    return {
      snapshot: saved.snapshot,
      stats: {
        tables: saved.snapshot.objectTypes.length,
        relationships: saved.snapshot.relationships.length,
        merged: !!existing,
      },
    };
  }

  /**
   * Sample distinct values for string columns that are candidates for a controlled value
   * set. Caps the scan at one above the cardinality threshold so the assembler can tell a
   * genuinely-small value set from a truncated (incomplete) sample and red-flag accordingly.
   */
  private async gatherSamples(
    tenantId: string,
    connectorId: string,
    metadata: { tables: string[]; columnsByTable: Record<string, Array<{ name: string; dbType: string }>>; foreignKeys: Array<{ sourceTable: string; sourceColumn: string }> },
  ): Promise<ReverseInferenceSample[]> {
    const fkCols = new Set(metadata.foreignKeys.map((fk) => `${fk.sourceTable}::${fk.sourceColumn}`));
    const samples: ReverseInferenceSample[] = [];
    for (const table of metadata.tables) {
      for (const col of metadata.columnsByTable[table] ?? []) {
        if (mapColumnType(col.dbType) !== 'string') continue;
        if (fkCols.has(`${table}::${col.name}`)) continue;
        try {
          const { values, truncated } = await this.introspection.sampleDistinctValues(
            tenantId,
            connectorId,
            table,
            col.name,
            ALLOWED_VALUES_CARDINALITY_CAP,
          );
          samples.push({ table, column: col.name, distinctValues: values, truncated });
        } catch {
          // A column we can't sample (permissions, exotic type) simply yields no allowedValues.
        }
      }
    }
    return samples;
  }
}
