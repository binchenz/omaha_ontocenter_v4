import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { CurrentUser as CurrentUserType, PropertyDefinition } from '@omaha/shared-types';
import { assertCapability } from '../../common/helpers/assert-capability';
import { OntologyService } from '../ontology/ontology.service';
import { TypeResolver } from '../agent/sdk/type-resolver.service';
import { renderSemanticsHints, toRenderableSemantics } from './semantics-renderer';

/**
 * The Ontology schema as the Agent sees it. Property shape derives from the canonical
 * PropertyDefinition in @omaha/shared-types — new fields (allowedValues, unit, …) flow
 * through without manual sync (the Single-Source-of-Truth fix from ADR-0042 review).
 */
export interface OntologySchema {
  types: Array<{
    name: string;
    label: string;
    description?: string;
    properties: PropertyDefinition[];
    derivedProperties: Array<{ name: string; type: string; label: string }>;
    actions: Array<{ name: string; label: string; description?: string; parameters: Array<{ name: string; type: string; label: string; required: boolean }> }>;
    /**
     * ADR-0061 §3: structural-semantics warnings the Agent must heed (folded
     * dimensions now; universe in #191), rendered by SemanticsRenderer. Replaces
     * the skill prose that encoded these rules. Empty/absent for plain types.
     */
    semanticsHints?: string[];
  }>;
  relationships: Array<{
    name: string;
    sourceType: string;
    targetType: string;
    cardinality: string;
    description?: string;
  }>;
}

type PropertyType = PropertyDefinition['type'];

function mapPropertyDto(p: { name: string; type: string; label: string; filterable?: boolean; sortable?: boolean; description?: string; unit?: string; allowedValues?: string[] }) {
  return {
    name: p.name,
    type: p.type as PropertyType,
    label: p.label,
    filterable: p.filterable,
    sortable: p.sortable,
    description: p.description,
    unit: p.unit,
    allowedValues: p.allowedValues,
  };
}

/**
 * Owns Ontology design: schema projection + caching, and all Ontology write operations
 * with their capability gates and cache invalidations. Injects only OntologyService,
 * TypeResolver, and Prisma (for the atomic delete transaction).
 */
@Injectable()
export class OntologySdk {
  constructor(
    private readonly ontologyService: OntologyService,
    private readonly typeResolver: TypeResolver,
    private readonly prisma: PrismaService,
  ) {}

  async getSchema(tenantId: string): Promise<OntologySchema> {
    const [types, relationships, actionDefs] = await Promise.all([
      this.ontologyService.listObjectTypes(tenantId),
      this.ontologyService.listRelationships(tenantId),
      this.prisma.actionDefinition.findMany({ where: { tenantId } }),
    ]);

    // Group actions by objectType for efficient lookup
    const actionsByType = new Map<string, Array<{ name: string; label: string; description?: string; parameters: any[] }>>();
    for (const ad of actionDefs) {
      const list = actionsByType.get(ad.objectType) ?? [];
      list.push({
        name: ad.name,
        label: ad.label,
        description: (ad as any).description || undefined,
        parameters: ((ad as any).parameters ?? []).map((p: any) => ({
          name: p.name, type: p.type, label: p.label, required: p.required,
        })),
      });
      actionsByType.set(ad.objectType, list);
    }

    return {
      types: types.map((t: any) => ({
        name: t.name,
        label: t.label,
        description: t.description ?? undefined,
        properties: (t.properties ?? []).map((p: any) => ({
          name: p.name, type: p.type, label: p.label, filterable: p.filterable, sortable: p.sortable,
          description: p.description, unit: p.unit, allowedValues: p.allowedValues,
        })),
        derivedProperties: (t.derivedProperties ?? []).map((d: any) => ({
          name: d.name, type: d.type, label: d.label,
        })),
        actions: actionsByType.get(t.name) ?? [],
        // ADR-0061 §3: lift folded-dimension / universe semantics into Agent-readable hints.
        semanticsHints: renderSemanticsHints(toRenderableSemantics(t)),
      })),
      relationships: relationships.map((r: any) => ({
        name: r.name,
        sourceType: r.sourceType.name,
        targetType: r.targetType.name,
        cardinality: r.cardinality,
        description: r.description ?? undefined,
      })),
    };
  }

  private schemaSummaryCache = new Map<string, { summary: string; typeNames: string[] }>();

  invalidateSchemaSummary(tenantId: string): void {
    this.schemaSummaryCache.delete(tenantId);
  }

  /** Combined cache+resolver invalidation, exposed so ResearchSdk can flush after AVC ingest. */
  invalidate(tenantId: string): void {
    this.typeResolver.invalidate(tenantId);
    this.invalidateSchemaSummary(tenantId);
  }

  async getSchemaSummary(tenantId: string): Promise<{ summary: string; typeNames: string[] }> {
    const cached = this.schemaSummaryCache.get(tenantId);
    if (cached) return cached;

    const schema = await this.getSchema(tenantId);
    const typeNames = schema.types.map(t => t.name);
    const lines: string[] = ['数据模型：'];
    // ADR-0050 invariant: a type's *existence* is never truncated — every type is listed.
    // Field *detail* is eager only within this budget; beyond it the line is name+description
    // only, and detail is pulled lazily via get_ontology_schema(typeName).
    const detailBudget = 25;
    const MAX_DESC = 50; // soft-truncate field descriptions to keep prompt budget bounded
    schema.types.forEach((t, i) => {
      const typeDesc = t.description ? ` — ${t.description}` : '';
      if (i >= detailBudget) {
        lines.push(`- ${t.name}${typeDesc}`);
        return;
      }
      const props = t.properties
        .filter(p => p.filterable || p.sortable)
        .map(p => {
          let s = `${p.name}:${p.type}`;
          if (p.filterable) s += '✓';
          if (p.sortable) s += '↕';
          if (p.unit) s += `[${p.unit}]`;
          if (p.description) {
            const d = p.description.length > MAX_DESC ? `${p.description.slice(0, MAX_DESC)}…` : p.description;
            s += `{${d}}`;
          }
          if (p.allowedValues && p.allowedValues.length > 0) {
            const shown = p.allowedValues.slice(0, 8).join('|');
            s += `=(${shown}${p.allowedValues.length > 8 ? '|…' : ''})`;
          }
          return s;
        })
        .join(', ');
      lines.push(`- ${t.name}(${props})${typeDesc}`);
    });
    if (schema.relationships.length > 0) {
      const rels = schema.relationships.map(r => {
        const desc = r.description ? `(${r.description})` : '';
        return `${r.sourceType}→${r.targetType}(${r.name})${desc}`;
      }).join(', ');
      lines.push(`关系：${rels}`);
    }
    if (schema.types.length > detailBudget) {
      lines.push(`（以上 ${detailBudget} 个类型含字段详情；其余 ${schema.types.length - detailBudget} 个仅列出名称，需要其字段时请调用 get_ontology_schema 并传入 typeName）`);
    }
    const result = { summary: lines.join('\n'), typeNames };
    this.schemaSummaryCache.set(tenantId, result);
    return result;
  }

  /**
   * Data-derived tenant profile (Hermes-inspired per-tenant context). Unlike getSchemaSummary
   * (which describes the model — what types/fields *could* hold), this describes what the tenant
   * has *actually loaded*: per-type row counts + the distinct values of each low-cardinality
   * filterable string property. That is what tells the Agent "this tenant analyzes 电饭煲/净水器
   * small appliances", grounding it in the customer's real data.
   *
   * Deliberately NOT cached: row counts and distinct values change on every data import, and the
   * import path (SyncJob → ImportEngine) never triggers schema-cache invalidation — a cache here
   * would silently go stale. The cost is one indexed groupBy + a few low-cardinality distincts,
   * negligible next to the LLM call it precedes. Returns '' when the tenant has no data, so the
   * caller can skip the prompt segment entirely.
   */
  async getTenantProfile(tenantId: string): Promise<string> {
    const MAX_DISTINCT = 20; // only enumerate genuinely categorical properties, not free text/ids
    const schema = await this.getSchema(tenantId);

    const countRows = await this.prisma.$queryRawUnsafe<Array<{ object_type: string; n: bigint }>>(
      `SELECT object_type, COUNT(*) AS n FROM object_instances
       WHERE tenant_id = $1::uuid AND deleted_at IS NULL
       GROUP BY object_type`,
      tenantId,
    );
    const countByType = new Map(countRows.map((r) => [r.object_type, Number(r.n)]));
    if (countByType.size === 0) return '';

    // Derive each populated type's dimensions concurrently — independent DISTINCT probes that
    // would otherwise serialize on every chat turn (getTenantProfile is intentionally uncached).
    const populated = schema.types.filter((t) => countByType.get(t.name));
    const dimsByType = new Map(
      await Promise.all(
        populated.map(async (t): Promise<[string, string]> => [
          t.name,
          await this.deriveTypeDimensions(tenantId, t, MAX_DISTINCT),
        ]),
      ),
    );
    const lines = ['本租户已导入数据：', ...populated.map((t) => {
      const count = countByType.get(t.name)!;
      const dims = dimsByType.get(t.name);
      return `- ${t.name}（${count} 行）${dims ? `：${dims}` : ''}`;
    })];
    return lines.join('\n');
  }

  /**
   * For one type, render its low-cardinality filterable string properties as `prop=v1/v2/...`.
   * Uses schema-declared allowedValues when present (zero DB cost); otherwise probes DISTINCT and
   * skips the property when cardinality exceeds the cap (high-cardinality = not a useful label).
   */
  private async deriveTypeDimensions(
    tenantId: string,
    type: OntologySchema['types'][number],
    cap: number,
  ): Promise<string> {
    // Probe each categorical property concurrently — the DISTINCT scans are independent.
    const candidates = type.properties.filter((p) => p.type === 'string' && p.filterable);
    const parts = await Promise.all(candidates.map(async (p) => {
      let values: string[];
      if (p.allowedValues && p.allowedValues.length > 0) {
        values = p.allowedValues; // schema-declared — zero DB cost
      } else {
        const rows = await this.prisma.$queryRawUnsafe<Array<{ v: string | null }>>(
          `SELECT DISTINCT properties->>$2 AS v FROM object_instances
           WHERE tenant_id = $1::uuid AND object_type = $3 AND deleted_at IS NULL
             AND properties->>$2 IS NOT NULL
           LIMIT $4`,
          tenantId, p.name, type.name, cap + 1,
        );
        values = rows.map((r) => r.v).filter((v): v is string => v !== null);
      }
      // Skip empty (no rows) and high-cardinality (free text/ids — not a useful label).
      if (values.length === 0 || values.length > cap) return null;
      return `${p.name}=${values.join('/')}`;
    }));
    return parts.filter((x): x is string => x !== null).join('，');
  }

  /** Tier-1 lazy detail (ADR-0050): full schema projection for a single object type. */
  async getTypeDetail(tenantId: string, typeName: string): Promise<OntologySchema> {
    const schema = await this.getSchema(tenantId);
    const target = schema.types.find(t => t.name === typeName);
    if (!target) {
      const available = schema.types.map(t => t.name).slice(0, 10);
      const more = schema.types.length > 10 ? ` (共 ${schema.types.length} 个，调用 get_ontology_schema() 查看完整列表)` : '';
      throw new NotFoundException(`对象类型 "${typeName}" 不存在。可用类型：${available.join(', ')}${more}`);
    }
    const relationships = schema.relationships.filter(
      r => r.sourceType === typeName || r.targetType === typeName,
    );
    return { types: [target], relationships };
  }

  // --- Ontology writes (each gated on ontology.design) ---

  async createObjectType(actor: CurrentUserType, dto: {
    name: string;
    label: string;
    description?: string;
    properties: Array<{ name: string; type: string; label: string; filterable?: boolean; sortable?: boolean; description?: string; unit?: string; allowedValues?: string[] }>;
  }): Promise<unknown> {
    assertCapability(actor, 'ontology', 'design');
    const tenantId = actor.tenantId;
    const result = await this.ontologyService.createObjectType(tenantId, {
      name: dto.name,
      label: dto.label,
      description: dto.description,
      properties: dto.properties.map(mapPropertyDto),
      derivedProperties: [],
    });
    this.invalidate(tenantId);
    return result;
  }

  async updateObjectType(actor: CurrentUserType, params: {
    objectTypeName: string;
    label?: string;
    description?: string;
    properties: Array<{ name: string; type: string; label: string; filterable?: boolean; sortable?: boolean; description?: string; unit?: string; allowedValues?: string[] }>;
  }): Promise<unknown> {
    assertCapability(actor, 'ontology', 'design');
    const tenantId = actor.tenantId;
    const typeId = await this.typeResolver.resolve(tenantId, params.objectTypeName);
    return this.ontologyService.updateObjectType(tenantId, typeId, {
      ...(params.label ? { label: params.label } : {}),
      properties: params.properties.map(mapPropertyDto),
    });
  }

  async deleteObjectType(actor: CurrentUserType, objectTypeName: string): Promise<unknown> {
    assertCapability(actor, 'ontology', 'design');
    const tenantId = actor.tenantId;
    const typeId = await this.typeResolver.resolve(tenantId, objectTypeName);
    await this.prisma.$transaction(async (tx: any) => {
      await tx.objectInstance.updateMany({
        where: { tenantId, objectType: objectTypeName, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      await this.ontologyService.deleteObjectType(tenantId, typeId);
    });
    this.invalidate(tenantId);
    return { message: `对象类型 "${objectTypeName}" 已删除，关联数据已软删除。` };
  }

  async createRelationship(actor: CurrentUserType, params: {
    name: string;
    sourceType: string;
    targetType: string;
    cardinality: string;
  }): Promise<unknown> {
    assertCapability(actor, 'ontology', 'design');
    const tenantId = actor.tenantId;
    const ids = await this.typeResolver.resolveMany(tenantId, [params.sourceType, params.targetType]);
    return this.ontologyService.createRelationship(tenantId, {
      name: params.name,
      sourceTypeId: ids.get(params.sourceType)!,
      targetTypeId: ids.get(params.targetType)!,
      cardinality: params.cardinality as any,
    });
  }

  async deleteRelationship(actor: CurrentUserType, params: {
    name: string;
    sourceType: string;
  }): Promise<unknown> {
    assertCapability(actor, 'ontology', 'design');
    const tenantId = actor.tenantId;
    const relationships = await this.ontologyService.listRelationships(tenantId);
    const target = relationships.find((r: any) => r.name === params.name && r.sourceType.name === params.sourceType);
    if (!target) throw new Error(`关系 "${params.name}" 不存在`);
    await this.ontologyService.deleteRelationship(tenantId, (target as any).id);
    return { message: `关系 "${params.name}" 已删除。` };
  }
}

