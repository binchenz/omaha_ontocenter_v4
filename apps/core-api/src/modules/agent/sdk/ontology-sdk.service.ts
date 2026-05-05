import { Injectable } from '@nestjs/common';
import { OntologyService } from '../../ontology/ontology.service';
import { QueryService } from '../../query/query.service';
import { PrismaService } from '@omaha/db';
import { CurrentUser as CurrentUserType } from '@omaha/shared-types';
import { TypeResolver } from './type-resolver.service';

export interface OntologySchema {
  types: Array<{
    name: string;
    label: string;
    properties: Array<{ name: string; type: string; label: string; filterable?: boolean; sortable?: boolean }>;
    derivedProperties: Array<{ name: string; type: string; label: string }>;
  }>;
  relationships: Array<{
    name: string;
    sourceType: string;
    targetType: string;
    cardinality: string;
  }>;
}

@Injectable()
export class OntologySdkService {
  constructor(
    private readonly ontologyService: OntologyService,
    private readonly queryService: QueryService,
    private readonly prisma: PrismaService,
    private readonly typeResolver: TypeResolver,
  ) {}

  async getSchema(tenantId: string): Promise<OntologySchema> {
    const [types, relationships] = await Promise.all([
      this.ontologyService.listObjectTypes(tenantId),
      this.ontologyService.listRelationships(tenantId),
    ]);

    return {
      types: types.map((t: any) => ({
        name: t.name,
        label: t.label,
        properties: (t.properties ?? []).map((p: any) => ({
          name: p.name,
          type: p.type,
          label: p.label,
          filterable: p.filterable,
          sortable: p.sortable,
        })),
        derivedProperties: (t.derivedProperties ?? []).map((d: any) => ({
          name: d.name,
          type: d.type,
          label: d.label,
        })),
      })),
      relationships: relationships.map((r: any) => ({
        name: r.name,
        sourceType: r.sourceType.name,
        targetType: r.targetType.name,
        cardinality: r.cardinality,
      })),
    };
  }

  async queryObjects(user: CurrentUserType, req: any) {
    return this.queryService.queryObjects(user, req);
  }

  async createObjectType(tenantId: string, dto: {
    name: string;
    label: string;
    properties: Array<{ name: string; type: string; label: string; filterable?: boolean; sortable?: boolean }>;
  }): Promise<unknown> {
    const result = await this.ontologyService.createObjectType(tenantId, {
      name: dto.name,
      label: dto.label,
      properties: dto.properties.map(p => ({
        name: p.name,
        type: p.type as 'string' | 'number' | 'boolean' | 'date' | 'json',
        label: p.label,
        filterable: p.filterable,
        sortable: p.sortable,
      })),
      derivedProperties: [],
    });
    this.typeResolver.invalidate(tenantId);
    return result;
  }

  async updateObjectType(tenantId: string, params: {
    objectTypeName: string;
    label?: string;
    properties: Array<{ name: string; type: string; label: string; filterable?: boolean; sortable?: boolean }>;
  }): Promise<unknown> {
    const typeId = await this.typeResolver.resolve(tenantId, params.objectTypeName);

    return this.ontologyService.updateObjectType(tenantId, typeId, {
      ...(params.label ? { label: params.label } : {}),
      properties: params.properties.map(p => ({
        name: p.name,
        type: p.type as 'string' | 'number' | 'boolean' | 'date' | 'json',
        label: p.label,
        filterable: p.filterable,
        sortable: p.sortable,
      })),
    });
  }

  async deleteObjectType(tenantId: string, objectTypeName: string): Promise<unknown> {
    const typeId = await this.typeResolver.resolve(tenantId, objectTypeName);

    await this.prisma.$transaction(async (tx: any) => {
      await tx.objectInstance.updateMany({
        where: { tenantId, objectType: objectTypeName, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      await this.ontologyService.deleteObjectType(tenantId, typeId);
    });

    this.typeResolver.invalidate(tenantId);
    return { message: `对象类型 "${objectTypeName}" 已删除，关联数据已软删除。` };
  }

  async createRelationship(tenantId: string, params: {
    name: string;
    sourceType: string;
    targetType: string;
    cardinality: string;
  }): Promise<unknown> {
    const ids = await this.typeResolver.resolveMany(tenantId, [params.sourceType, params.targetType]);

    return this.ontologyService.createRelationship(tenantId, {
      name: params.name,
      sourceTypeId: ids.get(params.sourceType)!,
      targetTypeId: ids.get(params.targetType)!,
      cardinality: params.cardinality as any,
    });
  }

  async deleteRelationship(tenantId: string, params: {
    name: string;
    sourceType: string;
  }): Promise<unknown> {
    const relationships = await this.ontologyService.listRelationships(tenantId);
    const target = relationships.find((r: any) => r.name === params.name && r.sourceType.name === params.sourceType);
    if (!target) throw new Error(`关系 "${params.name}" 不存在`);

    await this.ontologyService.deleteRelationship(tenantId, (target as any).id);
    return { message: `关系 "${params.name}" 已删除。` };
  }
}
