import { BadRequestException, Injectable } from '@nestjs/common';
import type { OntologyView } from '@omaha/dsl';
import type { QueryFilter } from '@omaha/shared-types';
import { PrismaService } from '@omaha/db';

/** The subset of plan args the enforcer reads/mutates — its filters are constrained in place. */
interface DimensionArgs {
  tenantId: string;
  objectType: string;
  filters?: QueryFilter[];
  /** Present on aggregate paths. Grouping a defaulted dimension means the caller is DRILLING it,
   * so its default must NOT be injected (else the group collapses to the single default row). */
  groupBy?: string[];
}

/**
 * Enforces ADR-0057 dimension constraints — the one place that invariant lives, so every plan path
 * (regular / aggregate / cross-rel aggregate) gates through a single seam. Two jobs behind one
 * `apply` call:
 *  - **defaulted dimensions** are auto-injected as `eq` filters when the query left them unconstrained
 *    (e.g. priceBand=整体), so a query that omits a collapsible dimension still pins it.
 *  - **required dimensions** that no filter references throw a structured DIMENSION_REQUIRED
 *    BadRequestException carrying the field and its scoped available values, so the Agent can recover
 *    by re-filtering instead of silently averaging across periods (the multi-period ambiguity trap).
 *
 * Deep module: the default-injection + required-enforcement + scoped-available-values DB probe are
 * substantial behavior behind a narrow `apply(args, view)` interface. The planner calls it in one line.
 */
@Injectable()
export class DimensionConstraintEnforcer {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Apply ADR-0057 constraints for the given view. Mutates `args.filters` in place (injecting
   * defaults), and throws DIMENSION_REQUIRED if a required dimension is still unconstrained. No-op
   * when the view declares no dimensions (non-AVC types).
   */
  async apply(args: DimensionArgs, view: OntologyView | null): Promise<void> {
    if (!view?.dimensions) return;
    args.filters = args.filters ? [...args.filters] : [];
    this.injectDefaults(args.filters, view.dimensions.defaults, args.groupBy ?? []);
    await this.enforceRequired(
      args.tenantId,
      args.objectType,
      args.filters,
      view.dimensions.required,
      view.dimensions.requiredEquivalents ?? {},
    );
  }

  /**
   * Inject default dimension values for dimensions not already constrained. Mutates in place.
   * A dimension being GROUPED is skipped: grouping it is an explicit drill, so pinning it to its
   * default would collapse the group to one row (the dimension-default-blindspot, ADR-0061).
   */
  private injectDefaults(filters: QueryFilter[], defaults: Record<string, string>, groupBy: string[]): void {
    const grouped = new Set(groupBy);
    for (const [field, defaultValue] of Object.entries(defaults)) {
      if (!hasFieldFilter(filters, field) && !grouped.has(field)) {
        filters.push({ field, operator: 'eq', value: defaultValue });
      }
    }
  }

  /**
   * Throw a structured DIMENSION_REQUIRED error (with scoped available values) for the first
   * required dimension no filter references.
   */
  private async enforceRequired(
    tenantId: string,
    objectType: string,
    filters: QueryFilter[],
    required: string[],
    requiredEquivalents: Record<string, string[]>,
  ): Promise<void> {
    for (const dim of required) {
      // A required dim is satisfied by a filter on itself OR any declared equivalent (#178):
      // e.g. a `year` filter satisfies the `month` requirement for an annual rollup.
      const satisfiers = [dim, ...(requiredEquivalents[dim] ?? [])];
      if (!satisfiers.some((f) => hasFieldFilter(filters, f))) {
        const available = await this.getAvailableValues(tenantId, objectType, dim, filters);
        throw new BadRequestException({
          error: {
            code: 'DIMENSION_REQUIRED',
            message: `${objectType} 查询需要指定 ${dim} 过滤条件`,
            field: dim,
            available,
            hint: `请在 filters 中添加 { field: "${dim}", operator: "eq", value: "..." } 后重试。可用值：${available.join(', ')}`,
          },
        });
      }
    }
  }

  /**
   * Distinct values for a dimension field, scoped to whatever other filters are already applied
   * (e.g. if category=电饭煲, return only periods that exist for 电饭煲).
   */
  private async getAvailableValues(
    tenantId: string,
    objectType: string,
    field: string,
    existingFilters: QueryFilter[],
  ): Promise<string[]> {
    const conditions = [
      `tenant_id = $1::uuid`,
      `object_type = $2`,
      `deleted_at IS NULL`,
      `properties->>'${field}' IS NOT NULL`,
    ];
    const params: unknown[] = [tenantId, objectType];
    let paramIdx = 3;

    for (const f of existingFilters) {
      if (f.field === field) continue; // skip self
      if (f.operator === 'eq') {
        conditions.push(`properties->>'${f.field}' = $${paramIdx}`);
        params.push(f.value);
        paramIdx++;
      } else if (f.operator === 'in' && Array.isArray(f.value)) {
        const placeholders = f.value.map((_, i) => `$${paramIdx + i}`).join(',');
        conditions.push(`properties->>'${f.field}' IN (${placeholders})`);
        params.push(...f.value);
        paramIdx += f.value.length;
      }
    }

    const sql = `
      SELECT DISTINCT properties->>'${field}' AS val
      FROM object_instances
      WHERE ${conditions.join(' AND ')}
      ORDER BY val
      LIMIT 50
    `;

    const rows = await this.prisma.$queryRawUnsafe<Array<{ val: string }>>(sql, ...params);
    return rows.map((r) => r.val);
  }
}

/** A dimension is "present" if ANY filter references it (eq, in, gte, lte, etc.). */
function hasFieldFilter(filters: QueryFilter[], field: string): boolean {
  return filters.some((f) => f.field === field);
}
