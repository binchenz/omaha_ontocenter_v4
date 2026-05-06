/**
 * Pure helper for translating multiple foreign-key columns on a source row
 * into an `objectInstance.relationships` jsonb shape.
 *
 * Use this from inside an `IngestRecipe.relationships(row, ctx)` callback
 * (the escape hatch — see ADR-0016) when a row has 2+ FK references and
 * the simple `parentRef` shape doesn't fit. Examples: a row with both
 * `novel_id` and `outline_id`; reified relationships with `from_id` /
 * `to_id`; same-target multi-name relationships like `plantedIn` /
 * `resolvedIn` both pointing at Episode.
 *
 * For the common single-FK case, prefer `IngestRecipe.parentRef` over this.
 */
export interface FkSpecEntry {
  sourceTable: string;
  sourceColumn: string;
  relationshipName: string;
  targetTable: string;
}

export type FkSpec = FkSpecEntry[];

export type ExternalIdToInstanceId = Record<string, string>;

export type TargetTableLookup = Record<string, ExternalIdToInstanceId>;

export interface EnrichedRow<T = Record<string, unknown>> {
  row: T;
  relationships: Record<string, string>;
}

export function applyFkRelationships<T>(
  sourceTable: string,
  rows: T[],
  fkSpec: FkSpec,
  lookup: TargetTableLookup,
): EnrichedRow<T>[] {
  const applicable = fkSpec.filter((s) => s.sourceTable === sourceTable);

  return rows.map((row) => {
    const relationships: Record<string, string> = {};
    const r = row as unknown as Record<string, unknown>;
    for (const fk of applicable) {
      const value = r[fk.sourceColumn];
      if (value === null || value === undefined) continue;
      const externalId = String(value);
      const targetMap = lookup[fk.targetTable];
      const platformId = targetMap?.[externalId];
      if (!platformId) {
        throw new Error(
          `[fk-to-relationships] ${sourceTable}.${fk.sourceColumn}=${externalId} has no matching ${fk.targetTable} instance`,
        );
      }
      relationships[fk.relationshipName] = platformId;
    }
    return { row, relationships };
  });
}
