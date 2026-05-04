import { Injectable, Scope } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import type { OntologyView, OntologyDerivedPropertyView } from '@omaha/dsl';
import type { PropertyDefinition, DerivedPropertyDefinition } from '@omaha/shared-types';

@Injectable({ scope: Scope.REQUEST })
export class OntologyViewLoader {
  private cache = new Map<string, OntologyView | null>();

  constructor(private readonly prisma: PrismaService) {}

  async load(tenantId: string, objectType: string): Promise<OntologyView | null> {
    const key = `${tenantId}::${objectType}`;
    if (this.cache.has(key)) return this.cache.get(key)!;

    const ot = await this.prisma.objectType.findFirst({
      where: { tenantId, name: objectType },
    });
    if (!ot) {
      this.cache.set(key, null);
      return null;
    }

    const properties = (ot.properties ?? []) as unknown as PropertyDefinition[];
    const derivedList = (ot.derivedProperties ?? []) as unknown as DerivedPropertyDefinition[];

    const rels = await this.prisma.objectRelationship.findMany({
      where: { tenantId, sourceTypeId: ot.id },
      select: { name: true, targetType: { select: { name: true } } },
    });

    const view: OntologyView = {
      tenantId,
      objectType,
      numericFields: new Set(properties.filter((p) => p.type === 'number').map((p) => p.name)),
      booleanFields: new Set(properties.filter((p) => p.type === 'boolean').map((p) => p.name)),
      stringFields: new Set(properties.filter((p) => p.type === 'string').map((p) => p.name)),
      filterableFields: new Set(properties.filter((p) => p.filterable).map((p) => p.name)),
      sortableFields: new Set(properties.filter((p) => p.sortable).map((p) => p.name)),
      relations: Object.fromEntries(
        rels.map((r) => [r.name, { foreignKey: `${ot.name}Id` }]),
      ),
      derivedProperties: new Map(
        derivedList.map((d): [string, OntologyDerivedPropertyView] => [
          d.name,
          { name: d.name, expression: d.expression, params: d.params },
        ]),
      ),
    };

    this.cache.set(key, view);
    return view;
  }

  async loadWithTargetType(
    tenantId: string,
    objectType: string,
  ): Promise<{ view: OntologyView; relationTargets: Record<string, string> } | null> {
    const view = await this.load(tenantId, objectType);
    if (!view) return null;
    const ot = await this.prisma.objectType.findFirst({
      where: { tenantId, name: objectType },
      select: { id: true },
    });
    if (!ot) return null;
    const rels = await this.prisma.objectRelationship.findMany({
      where: { tenantId, sourceTypeId: ot.id },
      select: { name: true, targetType: { select: { name: true } } },
    });
    const relationTargets = Object.fromEntries(
      rels.map((r) => [r.name, r.targetType.name]),
    );
    return { view, relationTargets };
  }
}
