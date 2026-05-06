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

export async function importInstances(
  prisma: PrismaClient,
  tenantId: string,
  objectTypeName: string,
  instances: InstanceInput[],
): Promise<ImportResult> {
  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const inst of instances) {
    if (!inst.externalId) {
      skipped++;
      continue;
    }
    const existing = await prisma.objectInstance.findUnique({
      where: {
        tenantId_objectType_externalId: {
          tenantId,
          objectType: objectTypeName,
          externalId: inst.externalId,
        },
      },
      select: { id: true },
    });
    if (existing) {
      await prisma.objectInstance.update({
        where: { id: existing.id },
        data: {
          label: inst.label,
          properties: inst.properties as Prisma.InputJsonValue,
          relationships: (inst.relationships ?? {}) as Prisma.InputJsonValue,
          searchText: inst.searchText ?? null,
        },
      });
      updated++;
    } else {
      await prisma.objectInstance.create({
        data: {
          tenantId,
          objectType: objectTypeName,
          externalId: inst.externalId,
          label: inst.label,
          properties: inst.properties as Prisma.InputJsonValue,
          relationships: (inst.relationships ?? {}) as Prisma.InputJsonValue,
          searchText: inst.searchText ?? null,
        },
      });
      imported++;
    }
  }
  return { imported, updated, skipped };
}
