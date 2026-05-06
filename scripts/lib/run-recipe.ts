import { PrismaClient } from '@omaha/db';
import type { FilmAiV2SourceReader } from './film-ai-v2-source-reader';
import type { InstanceInput, ImportResult } from './object-instance-importer';
import type { CandidateCharacter } from './entity-resolver';
import { resolveCharacterName } from './entity-resolver';

// ============================================================================
// Ctx — flat shape passed through every recipe run.
// ============================================================================

export interface IngestCtx {
  prisma: PrismaClient;
  tenantId: string;
  reader: FilmAiV2SourceReader;

  /**
   * Pre-loaded source data, keyed arbitrarily (typically the recipe's objectType
   * or a logical name). Populated by the orchestrator before the recipe loop runs;
   * recipes pull from it via `recipe.read(ctx)`. This indirection is needed because
   * the source RDS connection is dropped before the (long) write phase begins.
   */
  sourceData: Record<string, unknown[]>;

  /** Cache: objectType -> (externalId -> platform id). Lazily populated. */
  externalIdMaps: Map<string, Record<string, string>>;

  /** Cache: `${objectType}::${groupBy}::${nameField}` -> (groupKey -> candidates). */
  candidatePools: Map<string, Map<string, CandidateCharacter[]>>;

  loadExternalIdMap(objectType: string): Promise<Record<string, string>>;

  loadCandidatePool(
    objectType: string,
    groupBy: string,
    nameField: string,
  ): Promise<Map<string, CandidateCharacter[]>>;
}

// ============================================================================
// Recipe — declarative per-ObjectType ingest spec.
//
// Shape rules:
//   - `read` reads source rows for this ObjectType. Function reference, not declarative.
//   - `toInstance` maps one row to one InstanceInput (or many, when `toInstances` is used).
//   - `parentRef` and `relationships` are mutually exclusive:
//       * `parentRef`: simple case — parent is another ObjectType; the row carries the
//         parent's source id in `sourceField`; runner handles lookup and writes
//         relationships.belongsTo automatically.
//       * `relationships`: escape hatch — you compute the relationships object yourself.
//         Use for multi-parent, reified relationships, or nullable-id-with-status shapes.
//   - `entityResolution` declares a candidate pool; runner injects a `resolve(name)` closure
//     scoped to the row's group into `toInstance`'s deps argument.
// ============================================================================

export interface ParentRef {
  /** The ObjectType whose externalId map this recipe looks up for parent ids. */
  objectType: string;
  /** The field on each source row that holds the parent's external id. */
  sourceField: string;
}

export interface EntityResolutionSpec {
  /** Which ObjectType supplies the candidates for name resolution. */
  candidatesFromObjectType: string;
  /** Source-row field that determines which group's candidates a row can match against. */
  groupBy: string;
  /** The `property` name on the candidate ObjectType that holds the human name. */
  nameField: string;
}

export interface RecipeDeps {
  /**
   * If the recipe declared `entityResolution`, a pre-scoped resolver closure.
   * The resolver searches only among candidates that share the row's `groupBy` key.
   * Returns the candidate's `externalId` or null.
   */
  resolve: (name: string) => string | null;
}

export interface IngestRecipe<TRow = any> {
  objectType: string;
  /**
   * Pull source rows for this recipe out of `ctx.sourceData`. The actual reading
   * from the source RDS is done up-front by the orchestrator before the source
   * connection is dropped; recipes only see in-memory data.
   */
  read: (ctx: IngestCtx) => TRow[];

  parentRef?: ParentRef;

  relationships?: (row: TRow, ctx: IngestCtx) => Record<string, string>;

  entityResolution?: EntityResolutionSpec;

  /** One row → one instance. Cannot coexist with `toInstances`. */
  toInstance?: (row: TRow, ctx: IngestCtx, deps: RecipeDeps) => InstanceInput;

  /** One row → N instances. For per-row fan-out (e.g. ChapterCharacterMention). */
  toInstances?: (row: TRow, ctx: IngestCtx, deps: RecipeDeps) => InstanceInput[];
}

// ============================================================================
// Result — what runRecipe returns to the orchestrator.
// ============================================================================

export interface IngestResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: number;
}

// ============================================================================
// The deep module.
// ============================================================================

export type Importer = (
  prisma: PrismaClient,
  tenantId: string,
  objectType: string,
  instances: InstanceInput[],
) => Promise<ImportResult>;

export async function runRecipe<TRow>(
  recipe: IngestRecipe<TRow>,
  ctx: IngestCtx,
  importer: Importer,
): Promise<IngestResult> {
  if (recipe.parentRef && recipe.relationships) {
    throw new Error(
      `Recipe ${recipe.objectType}: parentRef and relationships are mutually exclusive; pick one.`,
    );
  }
  if (recipe.toInstance && recipe.toInstances) {
    throw new Error(
      `Recipe ${recipe.objectType}: toInstance and toInstances are mutually exclusive; pick one.`,
    );
  }
  if (!recipe.toInstance && !recipe.toInstances) {
    throw new Error(
      `Recipe ${recipe.objectType}: must declare either toInstance or toInstances.`,
    );
  }

  const rows = recipe.read(ctx);

  let parentMap: Record<string, string> | null = null;
  if (recipe.parentRef) {
    parentMap = await ctx.loadExternalIdMap(recipe.parentRef.objectType);
  }

  let candidatePool: Map<string, CandidateCharacter[]> | null = null;
  if (recipe.entityResolution) {
    candidatePool = await ctx.loadCandidatePool(
      recipe.entityResolution.candidatesFromObjectType,
      recipe.entityResolution.groupBy,
      recipe.entityResolution.nameField,
    );
  }

  const instances: InstanceInput[] = [];
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    let parentPlatformId: string | null = null;
    if (recipe.parentRef && parentMap) {
      const rawRow = row as unknown as Record<string, unknown>;
      const parentExternalId = rawRow[recipe.parentRef.sourceField];
      if (parentExternalId === null || parentExternalId === undefined) {
        skipped++;
        continue;
      }
      const platformId = parentMap[String(parentExternalId)];
      if (!platformId) {
        skipped++;
        continue;
      }
      parentPlatformId = platformId;
    }

    const deps: RecipeDeps = {
      resolve: (name: string) => {
        if (!recipe.entityResolution || !candidatePool) return null;
        const rawRow = row as unknown as Record<string, unknown>;
        const groupKey = rawRow[recipe.entityResolution.groupBy];
        if (groupKey === null || groupKey === undefined) return null;
        const candidates = candidatePool.get(String(groupKey)) ?? [];
        return resolveCharacterName(name, candidates);
      },
    };

    let produced: InstanceInput[];
    try {
      if (recipe.toInstances) {
        produced = recipe.toInstances(row, ctx, deps);
      } else {
        produced = [recipe.toInstance!(row, ctx, deps)];
      }
    } catch (err) {
      errors++;
      console.warn(
        `[runRecipe] ${recipe.objectType} row error:`,
        (err as Error)?.message ?? err,
      );
      continue;
    }

    for (const inst of produced) {
      if (recipe.parentRef && parentPlatformId) {
        inst.relationships = { ...(inst.relationships ?? {}), belongsTo: parentPlatformId };
      } else if (recipe.relationships) {
        try {
          const rels = recipe.relationships(row, ctx);
          inst.relationships = { ...(inst.relationships ?? {}), ...rels };
        } catch (err) {
          errors++;
          console.warn(
            `[runRecipe] ${recipe.objectType} relationships callback error:`,
            (err as Error)?.message ?? err,
          );
          continue;
        }
      }
      instances.push(inst);
    }
  }

  let importResult: ImportResult = { imported: 0, updated: 0, skipped: 0 };
  if (instances.length > 0) {
    importResult = await importer(ctx.prisma, ctx.tenantId, recipe.objectType, instances);
  }

  const result: IngestResult = {
    imported: importResult.imported,
    updated: importResult.updated,
    skipped: skipped + importResult.skipped,
    errors,
  };

  console.log(
    `[ingest] ${recipe.objectType} imported=${result.imported} updated=${result.updated} skipped=${result.skipped} errors=${result.errors}`,
  );

  return result;
}
