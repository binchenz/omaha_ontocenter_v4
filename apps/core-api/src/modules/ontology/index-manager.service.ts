import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, PrismaService } from '@omaha/db';
import { PropertyDefinition } from '@omaha/shared-types';

export interface IndexReconcileResult {
  created: string[];
  dropped: string[];
  kept: string[];
}

type DesiredIndex = { indexName: string; field: string };

const PG_IDENT_MAX = 63;
const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

@Injectable()
export class IndexManagerService {
  constructor(private readonly prisma: PrismaService) {}

  async reconcile(tenantId: string, objectTypeId: string): Promise<IndexReconcileResult> {
    const ot = await this.prisma.objectType.findUnique({ where: { id: objectTypeId } });
    if (!ot || ot.tenantId !== tenantId) {
      throw new NotFoundException('ObjectType not found');
    }

    const tenantSlug = tenantSlugFor(tenantId);
    const properties = (ot.properties ?? []) as unknown as PropertyDefinition[];
    const desired = this.computeDesiredIndexes(tenantSlug, ot.name, properties);
    const existing = await this.listExistingIndexes(tenantSlug, ot.name);

    const desiredNames = new Set(desired.map((d) => d.indexName));
    const existingNames = new Set(existing);

    const toCreate = desired.filter((d) => !existingNames.has(d.indexName));
    const toDrop = existing.filter((name) => !desiredNames.has(name));
    const kept = existing.filter((name) => desiredNames.has(name));

    for (const d of toCreate) {
      await this.createIndex(d);
    }
    for (const name of toDrop) {
      await this.dropIndex(name);
    }

    return {
      created: toCreate.map((d) => d.indexName).sort(),
      dropped: [...toDrop].sort(),
      kept: [...kept].sort(),
    };
  }

  private computeDesiredIndexes(
    tenantSlug: string,
    objectTypeName: string,
    properties: PropertyDefinition[],
  ): DesiredIndex[] {
    const out: DesiredIndex[] = [];
    for (const p of properties) {
      if (!SAFE_IDENT.test(p.name)) {
        throw new BadRequestException(`Property name not safe for indexing: ${p.name}`);
      }
      if (p.filterable) {
        out.push({ indexName: this.indexName(tenantSlug, objectTypeName, p.name, 'f'), field: p.name });
      }
      if (p.sortable) {
        out.push({ indexName: this.indexName(tenantSlug, objectTypeName, p.name, 's'), field: p.name });
      }
    }
    return out;
  }

  private indexName(tenantSlug: string, objectTypeName: string, field: string, kindSuffix: 'f' | 's'): string {
    const prefix = `idx_oi_${tenantSlug}_`;
    const suffix = `_${kindSuffix}`;
    const budget = PG_IDENT_MAX - prefix.length - suffix.length - 1;
    const half = Math.floor(budget / 2);
    const ot = objectTypeName.slice(0, half);
    const fld = field.slice(0, budget - ot.length - 1);
    return `${prefix}${ot}_${fld}${suffix}`;
  }

  private async listExistingIndexes(tenantSlug: string, objectTypeName: string): Promise<string[]> {
    const pattern = `idx_oi_${tenantSlug}_%${objectTypeName.slice(0, 20)}%`;
    const rows = await this.prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'object_instances'
        AND indexname LIKE ${pattern}
    `;
    return rows.map((r) => r.indexname);
  }

  private async createIndex(d: DesiredIndex): Promise<void> {
    const stmt = Prisma.raw(
      `CREATE INDEX IF NOT EXISTS "${d.indexName}" ` +
        `ON object_instances (tenant_id, object_type, (properties->>'${d.field}'))`,
    );
    await this.prisma.$executeRaw(Prisma.sql`${stmt}`);
  }

  private async dropIndex(indexName: string): Promise<void> {
    const stmt = Prisma.raw(`DROP INDEX IF EXISTS "${indexName}"`);
    await this.prisma.$executeRaw(Prisma.sql`${stmt}`);
  }
}

function tenantSlugFor(tenantId: string): string {
  return tenantId.replace(/-/g, '').slice(0, 8);
}
