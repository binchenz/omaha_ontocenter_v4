import { Injectable } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { CurrentUser as CurrentUserType, PropertyDefinition } from '@omaha/shared-types';
import { assertCapability } from '../../common/helpers/assert-capability';
import { OntologyService } from '../ontology/ontology.service';
import { TypeResolver } from '../agent/sdk/type-resolver.service';

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
    const maxTypes = 15;
    const MAX_DESC = 50; // soft-truncate field descriptions to keep prompt budget bounded
    for (const t of schema.types.slice(0, maxTypes)) {
      const typeDesc = t.description ? ` — ${t.description}` : '';
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
    }
    if (schema.relationships.length > 0) {
      const rels = schema.relationships.map(r => {
        const desc = r.description ? `(${r.description})` : '';
        return `${r.sourceType}→${r.targetType}(${r.name})${desc}`;
      }).join(', ');
      lines.push(`关系：${rels}`);
    }
    if (schema.types.length > maxTypes) {
      lines.push(`（共${schema.types.length}个类型，更多请调用 get_ontology_schema）`);
    }
    const result = { summary: lines.join('\n'), typeNames };
    this.schemaSummaryCache.set(tenantId, result);
    return result;
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

