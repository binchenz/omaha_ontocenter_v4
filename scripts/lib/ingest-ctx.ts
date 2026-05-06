import { PrismaClient } from '@omaha/db';
import type { IngestCtx } from './run-recipe';
import type { FilmAiV2SourceReader } from './film-ai-v2-source-reader';
import type { CandidateCharacter } from './entity-resolver';

export function createIngestCtx(
  prisma: PrismaClient,
  tenantId: string,
  reader: FilmAiV2SourceReader,
  sourceData: Record<string, unknown[]> = {},
): IngestCtx {
  const externalIdMaps = new Map<string, Record<string, string>>();
  const candidatePools = new Map<string, Map<string, CandidateCharacter[]>>();

  async function loadExternalIdMap(objectType: string): Promise<Record<string, string>> {
    const cached = externalIdMaps.get(objectType);
    if (cached) return cached;
    const rows = await prisma.objectInstance.findMany({
      where: { tenantId, objectType },
      select: { id: true, externalId: true },
    });
    const map: Record<string, string> = {};
    for (const r of rows) map[r.externalId] = r.id;
    externalIdMaps.set(objectType, map);
    return map;
  }

  async function loadCandidatePool(
    objectType: string,
    groupBy: string,
    nameField: string,
  ): Promise<Map<string, CandidateCharacter[]>> {
    const cacheKey = `${objectType}::${groupBy}::${nameField}`;
    const cached = candidatePools.get(cacheKey);
    if (cached) return cached;
    const rows = await prisma.objectInstance.findMany({
      where: { tenantId, objectType },
      select: { externalId: true, properties: true },
    });
    const pool = new Map<string, CandidateCharacter[]>();
    for (const r of rows) {
      // candidate's name comes from properties[nameField]
      const props = (r.properties ?? {}) as Record<string, unknown>;
      const name = props[nameField];
      if (typeof name !== 'string') continue;
      // The group key is encoded in the candidate's externalId by convention:
      // BookCharacter externalId = '{book_external_id}::{name}'.
      // For more general cases, we read the groupBy field off properties.
      const groupKey = (() => {
        // Convention: if externalId looks like '<groupKey>::<rest>' and groupBy is the
        // candidate's parent objectType, we can parse from the externalId. But this is
        // fragile. Prefer reading groupBy directly off the candidate's relationships:
        // for parentRef-shaped recipes, the parent platform-id is in relationships.belongsTo.
        // The groupBy here, however, is the *source* row field name on the consumer side,
        // not on the candidate side. So we cannot know without convention.
        // Use the externalId composite convention.
        const parts = r.externalId.split('::');
        if (parts.length >= 2) return parts[0];
        return null;
      })();
      if (!groupKey) continue;
      const list = pool.get(groupKey) ?? [];
      list.push({ id: r.externalId, name });
      pool.set(groupKey, list);
    }
    candidatePools.set(cacheKey, pool);
    return pool;
  }

  return {
    prisma,
    tenantId,
    reader,
    sourceData,
    externalIdMaps,
    candidatePools,
    loadExternalIdMap,
    loadCandidatePool,
  };
}
