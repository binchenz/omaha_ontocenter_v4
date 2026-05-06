import { PrismaClient, Prisma } from '@omaha/db';
import type { PropertyDefinition } from '@omaha/shared-types';
import { IndexManagerService } from '../../apps/core-api/src/modules/ontology/index-manager.service';

export interface ObjectTypeSpec {
  name: string;
  label: string;
  properties: PropertyDefinition[];
}

export interface RelationshipSpec {
  sourceType: string;
  targetType: string;
  name: string;
  cardinality: 'one-to-one' | 'one-to-many' | 'many-to-many';
}

export interface OntologySpec {
  objectTypes: ObjectTypeSpec[];
  relationships: RelationshipSpec[];
}

export interface OntologyBootstrapResult {
  typeIdByName: Record<string, string>;
  typesCreated: number;
  typesUpdated: number;
  relationshipsCreated: number;
  indexesReconciled: number;
}

export async function bootstrapOntology(
  prisma: PrismaClient,
  tenantId: string,
  spec: OntologySpec,
): Promise<OntologyBootstrapResult> {
  const typeIdByName: Record<string, string> = {};
  let typesCreated = 0;
  let typesUpdated = 0;

  for (const t of spec.objectTypes) {
    const existing = await prisma.objectType.findUnique({
      where: { tenantId_name: { tenantId, name: t.name } },
    });
    if (existing) {
      const updated = await prisma.objectType.update({
        where: { id: existing.id },
        data: {
          label: t.label,
          properties: t.properties as unknown as Prisma.InputJsonValue,
        },
      });
      typeIdByName[t.name] = updated.id;
      typesUpdated++;
    } else {
      const created = await prisma.objectType.create({
        data: {
          tenantId,
          name: t.name,
          label: t.label,
          properties: t.properties as unknown as Prisma.InputJsonValue,
        },
      });
      typeIdByName[t.name] = created.id;
      typesCreated++;
    }
  }

  let relationshipsCreated = 0;
  for (const r of spec.relationships) {
    const sourceTypeId = typeIdByName[r.sourceType];
    const targetTypeId = typeIdByName[r.targetType];
    if (!sourceTypeId || !targetTypeId) {
      throw new Error(`Relationship ${r.name}: unknown sourceType=${r.sourceType} or targetType=${r.targetType}`);
    }
    const existing = await prisma.objectRelationship.findUnique({
      where: { tenantId_sourceTypeId_name: { tenantId, sourceTypeId, name: r.name } },
    });
    if (existing) continue;
    await prisma.objectRelationship.create({
      data: { tenantId, sourceTypeId, targetTypeId, name: r.name, cardinality: r.cardinality },
    });
    relationshipsCreated++;
  }

  const indexManager = new IndexManagerService(prisma as any);
  let indexesReconciled = 0;
  for (const name of Object.keys(typeIdByName)) {
    await indexManager.reconcile(tenantId, typeIdByName[name]);
    indexesReconciled++;
  }

  return { typeIdByName, typesCreated, typesUpdated, relationshipsCreated, indexesReconciled };
}
