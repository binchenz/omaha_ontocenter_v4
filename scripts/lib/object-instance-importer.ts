import { PrismaClient, Prisma } from '@omaha/db';

export interface InstanceInput {
  externalId: string;
  label: string;
  properties: Record<string, unknown>;
  relationships?: Record<string, unknown>;
  searchText?: string;
}

export interface ImportResult {
  imported: number;
  updated: number;
  skipped: number;
}

const BATCH_SIZE = 500;
const LOOKUP_BATCH = 5000;

export async function importInstances(
  prisma: PrismaClient,
  tenantId: string,
  objectTypeName: string,
  instances: InstanceInput[],
): Promise<ImportResult> {
  const valid = instances.filter((i) => !!i.externalId);
  const skipped = instances.length - valid.length;
  if (valid.length === 0) return { imported: 0, updated: 0, skipped };

  const existingIds = new Set<string>();
  for (let i = 0; i < valid.length; i += LOOKUP_BATCH) {
    const slice = valid.slice(i, i + LOOKUP_BATCH);
    const rows = await prisma.objectInstance.findMany({
      where: {
        tenantId,
        objectType: objectTypeName,
        externalId: { in: slice.map((v) => v.externalId) },
      },
      select: { externalId: true },
    });
    for (const r of rows) existingIds.add(r.externalId);
  }

  const toInsert = valid.filter((v) => !existingIds.has(v.externalId));
  const toUpdate = valid.filter((v) => existingIds.has(v.externalId));

  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    await prisma.objectInstance.createMany({
      data: batch.map((b) => ({
        tenantId,
        objectType: objectTypeName,
        externalId: b.externalId,
        label: b.label,
        properties: b.properties as Prisma.InputJsonValue,
        relationships: (b.relationships ?? {}) as Prisma.InputJsonValue,
        searchText: b.searchText ?? null,
      })),
      skipDuplicates: true,
    });
  }

  for (const u of toUpdate) {
    await prisma.objectInstance.updateMany({
      where: { tenantId, objectType: objectTypeName, externalId: u.externalId },
      data: {
        label: u.label,
        properties: u.properties as Prisma.InputJsonValue,
        relationships: (u.relationships ?? {}) as Prisma.InputJsonValue,
        searchText: u.searchText ?? null,
      },
    });
  }

  return { imported: toInsert.length, updated: toUpdate.length, skipped };
}
