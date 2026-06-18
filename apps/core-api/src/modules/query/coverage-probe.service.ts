import { Injectable } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import type { QueryFilter } from '@omaha/shared-types';
import { OntologyViewLoader } from '../ontology/ontology-view-loader.service';

/**
 * The result of probing a star's real coverage on its time axis.
 * `values` are the DISTINCT period values that actually exist (sorted); `min`/`max`
 * are the extremes; `isDense` is whether the realised series matches the star's
 * declared dense cadence (a continuous monthly run, no gaps).
 */
export interface CoverageResult {
  /** The series-axis field probed (from the star's timeAxis, ADR-0064 §1). */
  field: string;
  /** The DISTINCT period values that actually exist under the given filters, sorted. */
  values: string[];
  /** The earliest period present, or null when none. */
  min: string | null;
  /** The latest period present, or null when none. */
  max: string | null;
  /**
   * Whether the realised coverage is a dense/contiguous series. For a star
   * declared `density: 'dense'` with monthly grain this means "no missing months
   * between min and max"; for a sparse/snapshot star it is always false (a
   * snapshot star is never a continuous series). The Agent reads this to decide
   * whether a value gap is a real hole or just the star's nature.
   */
  isDense: boolean;
}

/**
 * CoverageProbe (ADR-0064 §3) — the engine primitive that answers "what periods
 * actually exist for THIS metric under THESE filters", always by querying the live
 * data, never by inference. It is the second half of the BUG-2 fix: paired with
 * slice ②'s `timeAxis` cadence hint (read from schema), it lets the Agent learn
 * the real 53-month coverage of `market_metric` instead of reverse-inferring from
 * `brand_share`'s 5 sparse snapshots.
 *
 * Hard boundary (ADR-0043 §2, ADR-0064 §3): grain/density (the intended shape)
 * live in the ontology (`timeAxis`); the actual periods (which change on every
 * ingest) are NEVER stored there — they are always probed here. Each star probes
 * its OWN coverage on its OWN axis; this module never reads a sibling star's
 * report-period table to stand in for it.
 *
 * Deep module: a narrow `coverage(...)` interface over the field-resolution +
 * scoped DISTINCT probe + density classification. Mirrors the live-probe idiom of
 * DimensionConstraintEnforcer.getAvailableValues.
 */
@Injectable()
export class CoverageProbe {
  constructor(
    private readonly prisma: PrismaService,
    private readonly viewLoader: OntologyViewLoader,
  ) {}

  /**
   * Probe the real coverage of `objectType` on its declared time axis, scoped to
   * `dimensionFilters` (e.g. category=电饭煲, metric=零售额). Returns the distinct
   * periods that exist, their extremes, and whether the series is dense.
   *
   * @param fieldOverride  probe this field instead of the star's timeAxis field
   *                       (used when a star declares no timeAxis but the caller
   *                       knows the period column). When absent and no timeAxis is
   *                       declared, returns an empty coverage rather than guessing.
   */
  async coverage(
    tenantId: string,
    objectType: string,
    dimensionFilters: QueryFilter[] = [],
    fieldOverride?: string,
  ): Promise<CoverageResult> {
    const view = await this.viewLoader.load(tenantId, objectType);
    const field = fieldOverride ?? view?.timeAxis?.field;
    const declaredDense = view?.timeAxis?.density === 'dense';
    const grain = view?.timeAxis?.grain;

    if (!field) {
      // No series axis to probe — return an honest empty result, never a guess.
      return { field: '', values: [], min: null, max: null, isDense: false };
    }

    const values = await this.probeDistinct(tenantId, objectType, field, dimensionFilters);
    const min = values.length > 0 ? values[0] : null;
    const max = values.length > 0 ? values[values.length - 1] : null;
    const isDense = classifyDense(values, declaredDense, grain);
    return { field, values, min, max, isDense };
  }

  /**
   * DISTINCT values of `field` on `objectType`, scoped to the eq/in filters.
   * Mirrors DimensionConstraintEnforcer.getAvailableValues: parameterised, skips a
   * self-filter, ordered ascending. Bounded by LIMIT to stay cheap.
   */
  private async probeDistinct(
    tenantId: string,
    objectType: string,
    field: string,
    filters: QueryFilter[],
  ): Promise<string[]> {
    const conditions = [
      `tenant_id = $1::uuid`,
      `object_type = $2`,
      `deleted_at IS NULL`,
      `properties->>'${field}' IS NOT NULL`,
    ];
    const params: unknown[] = [tenantId, objectType];
    let paramIdx = 3;

    for (const f of filters) {
      if (f.field === field) continue; // never constrain the axis we are enumerating
      if (!f.field) continue;
      if (f.operator === 'eq') {
        conditions.push(`properties->>'${f.field}' = $${paramIdx}`);
        params.push(f.value);
        paramIdx++;
      } else if (f.operator === 'in' && Array.isArray(f.value)) {
        // An empty `in` set matches nothing — emit `FALSE` rather than the invalid
        // `IN ()` (a SQL syntax error). Yields an honest empty coverage result.
        if (f.value.length === 0) {
          conditions.push('FALSE');
          continue;
        }
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
      LIMIT 500
    `;
    const rows = await this.prisma.$queryRawUnsafe<Array<{ val: string }>>(sql, ...params);
    return rows.map((r) => r.val);
  }
}

/**
 * Decide whether a realised period set is a dense/contiguous series. Pure and
 * exported for unit testing.
 *  - A sparse/snapshot star (declaredDense=false) is never a continuous series.
 *  - A dense monthly star is "dense" iff every month between min and max is present.
 *  - For other grains (or unparseable values) we fall back to declaredDense — the
 *    intent — rather than asserting a gap we cannot verify.
 */
export function classifyDense(values: string[], declaredDense: boolean, grain?: string): boolean {
  if (!declaredDense) return false;
  if (values.length <= 1) return true; // 0 or 1 point cannot have an internal gap
  if (grain === 'month') {
    const months = values.map(parseYyMm);
    if (months.some((m) => m === null)) return declaredDense; // unparseable → trust intent
    const ordinals = (months as number[]).slice().sort((a, b) => a - b);
    const expected = ordinals[ordinals.length - 1] - ordinals[0] + 1;
    const distinct = new Set(ordinals).size;
    return distinct === expected; // contiguous iff no month is missing
  }
  return declaredDense;
}

/** Parse a 'YY.MM' period into a month ordinal (year*12 + month), or null if malformed. */
function parseYyMm(value: string): number | null {
  const m = /^(\d{2})\.(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const yy = Number(m[1]);
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) return null;
  return yy * 12 + mm;
}
