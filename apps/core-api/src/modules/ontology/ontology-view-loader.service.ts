import { Injectable, Scope } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import type { OntologyView, OntologyDerivedPropertyView, RelationInfo } from '@omaha/dsl';
import type { PropertyDefinition, DerivedPropertyDefinition } from '@omaha/shared-types';

/** Parse the raw JSONB dimensions column into the typed shape (tolerant of nulls/empty). */
function parseDimensions(raw: unknown): OntologyView['dimensions'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const required = Array.isArray(obj.required) ? (obj.required as string[]) : [];
  const defaults = (obj.defaults && typeof obj.defaults === 'object') ? obj.defaults as Record<string, string> : {};
  const collapsedDefault = (obj.collapsedDefault && typeof obj.collapsedDefault === 'object')
    ? obj.collapsedDefault as Record<string, string>
    : undefined;
  const requiredEquivalents = (obj.requiredEquivalents && typeof obj.requiredEquivalents === 'object')
    ? obj.requiredEquivalents as Record<string, string[]>
    : undefined;
  if (required.length === 0 && Object.keys(defaults).length === 0 && !collapsedDefault && !requiredEquivalents) return undefined;
  return { required, defaults, collapsedDefault, requiredEquivalents };
}

/**
 * ADR-0061 §1: lift each property's `additivity` / `ratioOf` into the view's
 * additivity map. Only tagged fields enter the map — the guard reads absence as
 * `additive`. Returns undefined when no field carries a tag (the common case),
 * so non-AVC types pay nothing.
 */
function parseAdditivity(properties: PropertyDefinition[]): OntologyView['additivity'] {
  const map: NonNullable<OntologyView['additivity']> = new Map();
  for (const p of properties) {
    if (!p.additivity) continue;
    map.set(p.name, { kind: p.additivity, ratioOf: p.ratioOf });
  }
  return map.size > 0 ? map : undefined;
}

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

    // Relations in BOTH directions (ADR-0044). Outbound (this type is the
    // source): the related target holds the FK → fkSide='other'. Inbound (this
    // type is the target/many side): this type holds the FK → fkSide='self'.
    // The storage key is always the relation NAME.
    const [outbound, inbound] = await Promise.all([
      this.prisma.objectRelationship.findMany({
        where: { tenantId, sourceTypeId: ot.id },
        select: { name: true, targetType: { select: { name: true } } },
      }),
      this.prisma.objectRelationship.findMany({
        where: { tenantId, targetTypeId: ot.id },
        select: { name: true, sourceType: { select: { name: true } } },
      }),
    ]);
    const relations: Record<string, RelationInfo> = {};
    for (const r of outbound) relations[r.name] = { storageKey: r.name, otherType: r.targetType.name, fkSide: 'other' };
    for (const r of inbound) relations[r.name] = { storageKey: r.name, otherType: r.sourceType.name, fkSide: 'self' };

    const view: OntologyView = {
      tenantId,
      objectType,
      numericFields: new Set(properties.filter((p) => p.type === 'number').map((p) => p.name)),
      booleanFields: new Set(properties.filter((p) => p.type === 'boolean').map((p) => p.name)),
      stringFields: new Set(properties.filter((p) => p.type === 'string').map((p) => p.name)),
      filterableFields: new Set(properties.filter((p) => p.filterable).map((p) => p.name)),
      sortableFields: new Set(properties.filter((p) => p.sortable).map((p) => p.name)),
      relations,
      derivedProperties: new Map(
        derivedList.map((d): [string, OntologyDerivedPropertyView] => [
          d.name,
          { name: d.name, expression: d.expression, params: d.params },
        ]),
      ),
      dimensions: parseDimensions(ot.dimensions),
      additivity: parseAdditivity(properties),
    };

    this.cache.set(key, view);
    return view;
  }

  /**
   * Resolve a relationship by name regardless of direction. Delegates to the
   * cached view from `load()` — no additional DB round-trip (ADR-0044 simplify).
   */
  async resolveRelationByName(
    tenantId: string,
    currentType: string,
    relationName: string,
  ): Promise<{ otherType: string; storageKey: string; fkSide: 'self' | 'other' } | null> {
    const view = await this.load(tenantId, currentType);
    if (!view) return null;
    const rel = view.relations[relationName];
    return rel ? { otherType: rel.otherType, storageKey: rel.storageKey, fkSide: rel.fkSide } : null;
  }
}
