import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import type { QueryFilter } from '@omaha/shared-types';

/** DI token for the code-defined registry of gated star types (ADR-0044 amendment). */
export const PROVENANCE_GATE_REGISTRY = Symbol('PROVENANCE_GATE_REGISTRY');

/**
 * One gated Object Type's coverage contract. `categoryField`/`periodField` name the
 * fields ON THE STAR that carry the (品类, 周期) scope a Query Plan filters by; the
 * provenance row (`provenanceType`, fixed schema category/period/coverage) is matched
 * by value. `modelLayer` marks the type whose data is absent in essence reports.
 */
export interface ProvenanceGateEntry {
  objectType: string;
  provenanceType: string;
  categoryField: string;
  periodField: string;
  modelLayer: boolean;
}

/** The gate's verdict handed back to QueryService: a hard error and/or warnings. */
export interface ProvenanceVerdict {
  error?: 'AVC_REPORT_NOT_FOUND';
  warnings: string[];
}

export const ESSENCE_COVERAGE_WARNING = 'ESSENCE_COVERAGE_MODEL_UNAVAILABLE';

interface ProvenanceRow {
  category: string;
  period: string;
  coverage: string;
}

/**
 * Coverage Gate (ADR-0044 §3 + 2026-06-06 amendment). A collaborator injected into
 * QueryService so the generic query path — where the market-intelligence star objects
 * are actually read — enforces provenance, without QueryService depending on `avc_report`.
 *
 * Keys on the scope a Query Plan declares (category + optional period from its filters),
 * NOT on row-level `sourceReport`: the gate runs as a pre-flight, and an empty result set
 * (the case it exists to disambiguate) carries no rows to read a sourceReport from.
 *
 * Per-matched-report semantics: coverage flips per report over time, so a category-only
 * scan legitimately spans full and essence periods. The gate never rejects on scope
 * breadth — it fails only when the scope matches ZERO reports (a genuine never-ingested
 * gap), and warns (naming the essence period(s)) only for a model-layer query.
 */
@Injectable()
export class ProvenanceGate {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PROVENANCE_GATE_REGISTRY) private readonly registry: ProvenanceGateEntry[],
  ) {}

  async evaluate(tenantId: string, objectType: string, filters?: QueryFilter[]): Promise<ProvenanceVerdict> {
    const entry = this.registry.find((e) => e.objectType === objectType);
    if (!entry) return { warnings: [] };

    const category = this.scalarEq(filters, entry.categoryField);
    if (category == null) return { warnings: [] };
    const period = this.scalarEq(filters, entry.periodField);

    const reports = await this.lookup(tenantId, entry.provenanceType, category, period);
    if (reports.length === 0) return { error: 'AVC_REPORT_NOT_FOUND', warnings: [] };

    if (entry.modelLayer) {
      const essence = [...new Set(reports.filter((r) => r.coverage === 'essence').map((r) => r.period))].sort();
      if (essence.length > 0) {
        return { warnings: [`${ESSENCE_COVERAGE_WARNING}: ${essence.join(', ')}`] };
      }
    }
    return { warnings: [] };
  }

  /** Read the eq-filter value for a field, or null if absent / not a plain eq scalar. */
  private scalarEq(filters: QueryFilter[] | undefined, field: string): string | null {
    const hit = (filters ?? []).find((x) => x.field === field && x.operator === 'eq');
    return hit && (typeof hit.value === 'string' || typeof hit.value === 'number') ? String(hit.value) : null;
  }

  private async lookup(
    tenantId: string,
    provenanceType: string,
    category: string,
    period: string | null,
  ): Promise<ProvenanceRow[]> {
    const params: unknown[] = [tenantId, provenanceType, category];
    const conds = [
      'tenant_id = $1::uuid',
      'object_type = $2',
      'deleted_at IS NULL',
      `properties->>'category' = $3`,
    ];
    if (period != null) {
      params.push(period);
      conds.push(`properties->>'period' = $${params.length}`);
    }
    const sql = `SELECT properties->>'category' AS category, properties->>'period' AS period,
                        properties->>'coverage' AS coverage
                 FROM object_instances WHERE ${conds.join(' AND ')}`;
    return this.prisma.$queryRawUnsafe<ProvenanceRow[]>(sql, ...params);
  }
}
