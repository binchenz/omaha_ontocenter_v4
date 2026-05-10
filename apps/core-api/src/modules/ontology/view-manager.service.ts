import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { PropertyDefinition } from '@omaha/shared-types';

const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function viewName(tenantId: string, objectTypeName: string): string {
  const tSlug = tenantId.replace(/-/g, '').slice(0, 8);
  const safe = objectTypeName.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
  return `mv_${tSlug}_${safe}`.slice(0, 63);
}

@Injectable()
export class ViewManagerService {
  private readonly logger = new Logger(ViewManagerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createOrReplace(tenantId: string, objectTypeName: string, properties: PropertyDefinition[]): Promise<string> {
    const name = viewName(tenantId, objectTypeName);
    const indexableProps = properties.filter(p => (p.filterable || p.sortable) && SAFE_IDENT.test(p.name));

    const colExprs = indexableProps.map(p => {
      const cast = p.type === 'number' ? `::numeric` : '';
      return `(properties->>'${p.name}')${cast} AS "${p.name}"`;
    });

    const selectCols = [
      'id',
      'tenant_id',
      'object_type',
      'external_id',
      'label',
      'properties',
      'relationships',
      'search_text',
      'created_at',
      'updated_at',
      ...colExprs,
    ].join(', ');

    await this.prisma.$executeRawUnsafe(`DROP MATERIALIZED VIEW IF EXISTS "${name}"`);
    await this.prisma.$executeRawUnsafe(`
      CREATE MATERIALIZED VIEW "${name}" AS
      SELECT ${selectCols}
      FROM object_instances
      WHERE tenant_id = '${tenantId}'
        AND object_type = '${objectTypeName}'
        AND deleted_at IS NULL
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "${name}_id_idx" ON "${name}" (id)
    `);

    this.logger.log(`Created materialized view ${name} for ${objectTypeName}`);
    return name;
  }

  async drop(tenantId: string, objectTypeName: string): Promise<void> {
    const name = viewName(tenantId, objectTypeName);
    await this.prisma.$executeRawUnsafe(`DROP MATERIALIZED VIEW IF EXISTS "${name}"`);
  }

  async refresh(tenantId: string, objectTypeName: string): Promise<void> {
    const name = viewName(tenantId, objectTypeName);
    try {
      await this.prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY "${name}"`);
    } catch {
      // View may not exist yet — silently skip
    }
  }

  async exists(tenantId: string, objectTypeName: string): Promise<boolean> {
    const name = viewName(tenantId, objectTypeName);
    const rows = await this.prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (
        SELECT 1 FROM pg_matviews WHERE matviewname = $1
      ) AS exists`,
      name,
    );
    return rows[0]?.exists ?? false;
  }

  getViewName(tenantId: string, objectTypeName: string): string {
    return viewName(tenantId, objectTypeName);
  }
}
