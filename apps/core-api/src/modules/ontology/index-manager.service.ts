import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, PrismaService } from '@omaha/db';
import { PropertyDefinition } from '@omaha/shared-types';

export interface IndexReconcileResult {
  created: string[];
  dropped: string[];
  kept: string[];
}

const PG_IDENT_MAX = 63;
const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

type IndexKind = 'f' | 's';
type RegistryKind = 'filter' | 'sort';

type DesiredIndex = {
  field: string;
  kind: IndexKind;
  indexName: string;
};

@Injectable()
export class IndexManagerService {
  constructor(private readonly prisma: PrismaService) {}

  async reconcile(tenantId: string, objectTypeId: string): Promise<IndexReconcileResult> {
    const ot = await this.prisma.objectType.findUnique({ where: { id: objectTypeId } });
    if (!ot || ot.tenantId !== tenantId) {
      throw new NotFoundException('ObjectType not found');
    }

    const properties = (ot.properties ?? []) as unknown as PropertyDefinition[];
    const desired = computeDesiredIndexes(objectTypeId, properties);

    return this.prisma.$transaction(async (tx) => {
      await acquireLock(tx, tenantId, objectTypeId);

      const existingRegistry = await tx.objectTypeIndex.findMany({
        where: { tenantId, objectTypeId },
        select: { id: true },
      });
      if (existingRegistry.length === 0) {
        await selfHeal(tx, tenantId, objectTypeId, ot.name);
      }

      const current = await tx.objectTypeIndex.findMany({
        where: { tenantId, objectTypeId },
      });

      const currentByKey = new Map(current.map((c) => [`${c.field}:${c.kind}`, c]));
      const desiredByKey = new Map(desired.map((d) => [`${d.field}:${kindToRegistry(d.kind)}`, d]));

      const toCreate = desired.filter((d) => !currentByKey.has(`${d.field}:${kindToRegistry(d.kind)}`));
      const toDrop = current.filter((c) => !desiredByKey.has(`${c.field}:${c.kind}`));
      const kept = current.filter((c) => desiredByKey.has(`${c.field}:${c.kind}`));

      for (const d of toCreate) {
        await createIndex(tx, d);
        await tx.objectTypeIndex.create({
          data: {
            tenantId,
            objectTypeId,
            field: d.field,
            kind: kindToRegistry(d.kind),
            indexName: d.indexName,
          },
        });
      }
      for (const c of toDrop) {
        await dropIndex(tx, c.indexName);
        await tx.objectTypeIndex.delete({ where: { id: c.id } });
      }

      return {
        created: toCreate.map((d) => d.indexName).sort(),
        dropped: toDrop.map((c) => c.indexName).sort(),
        kept: kept.map((c) => c.indexName).sort(),
      };
    });
  }

  async dropAllFor(tenantId: string, objectTypeId: string): Promise<string[]> {
    return this.prisma.$transaction(async (tx) => {
      await acquireLock(tx, tenantId, objectTypeId);

      const rows = await tx.objectTypeIndex.findMany({
        where: { tenantId, objectTypeId },
      });
      if (rows.length === 0) return [];

      for (const r of rows) {
        await dropIndex(tx, r.indexName);
      }
      await tx.objectTypeIndex.deleteMany({
        where: { tenantId, objectTypeId },
      });
      return rows.map((r) => r.indexName).sort();
    });
  }
}

type Tx = Prisma.TransactionClient;

async function acquireLock(tx: Tx, tenantId: string, objectTypeId: string): Promise<void> {
  const key = `${tenantId}:${objectTypeId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'a:' + key}), hashtext(${'b:' + key}))`;
}

async function selfHeal(
  tx: Tx,
  tenantId: string,
  objectTypeId: string,
  objectTypeName: string,
): Promise<void> {
  const oldPattern = `idx_oi_${tenantSlugFor(tenantId)}_%${objectTypeName.slice(0, 20)}%`;
  const newPattern = `idx_oi_${otidHex(objectTypeId)}_%`;
  const rows = await tx.$queryRaw<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'object_instances'
      AND (indexname LIKE ${oldPattern} OR indexname LIKE ${newPattern})
  `;
  for (const { indexname } of rows) {
    const parsed = parseIndexName(indexname, tenantId, objectTypeId, objectTypeName);
    if (!parsed) continue;
    await tx.objectTypeIndex.upsert({
      where: { indexName: indexname },
      update: {},
      create: {
        tenantId,
        objectTypeId,
        field: parsed.field,
        kind: kindToRegistry(parsed.kind),
        indexName: indexname,
      },
    });
  }
}

function computeDesiredIndexes(objectTypeId: string, properties: PropertyDefinition[]): DesiredIndex[] {
  const out: DesiredIndex[] = [];
  for (const p of properties) {
    if (!SAFE_IDENT.test(p.name)) {
      throw new BadRequestException(`Property name not safe for indexing: ${p.name}`);
    }
    if (p.filterable) {
      out.push({ field: p.name, kind: 'f', indexName: makeIndexName(objectTypeId, p.name, 'f') });
    }
    if (p.sortable) {
      out.push({ field: p.name, kind: 's', indexName: makeIndexName(objectTypeId, p.name, 's') });
    }
  }
  return out;
}

async function createIndex(tx: Tx, d: DesiredIndex): Promise<void> {
  const stmt = Prisma.raw(
    `CREATE INDEX IF NOT EXISTS "${d.indexName}" ` +
      `ON object_instances (tenant_id, object_type, (properties->>'${d.field}'))`,
  );
  await tx.$executeRaw(Prisma.sql`${stmt}`);
}

async function dropIndex(tx: Tx, indexName: string): Promise<void> {
  const stmt = Prisma.raw(`DROP INDEX IF EXISTS "${indexName}"`);
  await tx.$executeRaw(Prisma.sql`${stmt}`);
}

function otidHex(objectTypeId: string): string {
  return objectTypeId.replace(/-/g, '');
}

function tenantSlugFor(tenantId: string): string {
  return tenantId.replace(/-/g, '').slice(0, 8);
}

function makeIndexName(objectTypeId: string, field: string, kind: IndexKind): string {
  const prefix = 'idx_oi_';
  const otid = otidHex(objectTypeId);
  const suffix = `_${kind}`;
  const budget = PG_IDENT_MAX - prefix.length - otid.length - 1 - suffix.length;
  const fld = field.slice(0, budget);
  return `${prefix}${otid}_${fld}${suffix}`;
}

function kindToRegistry(kind: IndexKind): RegistryKind {
  return kind === 'f' ? 'filter' : 'sort';
}

function parseIndexName(
  name: string,
  tenantId: string,
  objectTypeId: string,
  objectTypeName: string,
): { field: string; kind: IndexKind } | null {
  if (!name.endsWith('_f') && !name.endsWith('_s')) return null;
  const kind: IndexKind = name.endsWith('_f') ? 'f' : 's';
  const body = name.slice(0, -2);

  const newPrefix = `idx_oi_${otidHex(objectTypeId)}_`;
  if (body.startsWith(newPrefix)) {
    const field = body.slice(newPrefix.length);
    return SAFE_IDENT.test(field) ? { field, kind } : null;
  }

  const oldPrefix = `idx_oi_${tenantSlugFor(tenantId)}_`;
  if (body.startsWith(oldPrefix)) {
    const rest = body.slice(oldPrefix.length);
    const truncName = objectTypeName.slice(0, 20);
    if (rest.startsWith(truncName + '_')) {
      const field = rest.slice(truncName.length + 1);
      if (SAFE_IDENT.test(field)) return { field, kind };
    }
  }

  return null;
}
