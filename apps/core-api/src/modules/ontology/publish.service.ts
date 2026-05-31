import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService, Prisma } from '@omaha/db';
import {
  diffSnapshots,
  flattenSnapshot,
  hasBreakingChange,
  rowsToSnapshot,
  toProductionDerivedProperties,
  toProductionProperties,
  validateInstanceProperties,
  type OntologyRowSet,
  type OntologySnapshot,
  type SnapshotChange,
  type SnapshotObjectType,
} from '@omaha/shared-types';
import { DraftService } from './draft.service';
import { ArtifactManagerService } from './artifact-manager.service';

export interface PublishResult {
  createdTypes: string[];
  updatedTypes: string[];
  deletedTypes: string[];
  createdRelationships: string[];
  deletedRelationships: string[];
}

export interface PublishPreflight {
  changes: SnapshotChange[];
  hasBreaking: boolean;
  /** True when the publish can proceed without an explicit confirmation (no breaking changes). */
  canAutoPublish: boolean;
}

/**
 * Publishes a Draft snapshot to the production tables (ADR-0031). The single moment
 * design-time changes become visible to the runtime Agent. Mutates schema only —
 * `object_instances` is never touched. The whole flatten is applied in one
 * transaction so the published ontology is never left half-updated; index/view
 * artifacts are reconciled after the transaction commits (best-effort, same as the
 * existing OntologyService write path).
 */
@Injectable()
export class PublishService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly draftService: DraftService,
    private readonly artifactManager: ArtifactManagerService,
  ) {}

  /**
   * Publish preflight (ADR-0031 informed gate): diff the Draft against the live ontology,
   * classify each change safe/breaking (pure differ), and for breaking changes scan the
   * existing instances to attach an impact count. Reads instances but never mutates them.
   */
  async preflight(tenantId: string): Promise<PublishPreflight> {
    const draft = await this.draftService.getDraftOrThrow(tenantId);
    const rows = await this.loadPublishedRows(tenantId);
    return this.preflightFrom(tenantId, rows, draft.snapshot);
  }

  /** Preflight against already-loaded rows/draft, so the publish path needn't re-read them. */
  private async preflightFrom(
    tenantId: string,
    rows: OntologyRowSet,
    draft: OntologySnapshot,
  ): Promise<PublishPreflight> {
    const published = rowsToSnapshot(rows);
    const changes = diffSnapshots(published, draft);

    for (const change of changes) {
      if (change.tier === 'breaking') {
        change.impactCount = await this.countImpact(tenantId, change, draft);
      }
    }

    const breaking = hasBreakingChange(changes);
    return { changes, hasBreaking: breaking, canAutoPublish: !breaking };
  }

  /**
   * Count how many existing instances a breaking change affects. Schema-only publish
   * never migrates data; this number is purely informational for the OPC's decision.
   */
  private async countImpact(
    tenantId: string,
    change: SnapshotChange,
    draft: OntologySnapshot,
  ): Promise<number> {
    const objectType = change.objectType;
    switch (change.kind) {
      case 'drop-type':
        return this.prisma.objectInstance.count({ where: { tenantId, objectType, deletedAt: null } });

      case 'drop-field':
      case 'change-field-type': {
        // Instances carrying a present (non-null) value for the field are affected.
        if (!change.field) return 0;
        const instances = await this.prisma.objectInstance.findMany({
          where: { tenantId, objectType, deletedAt: null },
          select: { properties: true },
        });
        return instances.filter((i) => {
          const v = (i.properties as Record<string, unknown>)?.[change.field!];
          return v !== undefined && v !== null && v !== '';
        }).length;
      }

      case 'restrict-allowed-values': {
        // Reuse the import-time gate: count instances whose current value violates the
        // new (tightened/added) constraint — consistent with the whole-batch-reject rule.
        if (!change.field) return 0;
        const draftType = draft.objectTypes.find((t) => t.name === objectType);
        const propDef = draftType?.properties.find((p) => p.name === change.field);
        if (!propDef) return 0;
        const instances = await this.prisma.objectInstance.findMany({
          where: { tenantId, objectType, deletedAt: null },
          select: { properties: true },
        });
        return instances.filter(
          (i) => validateInstanceProperties(i.properties as Record<string, unknown>, [propDef]).length > 0,
        ).length;
      }

      case 'drop-relationship': {
        // Instances on the source type holding a pointer under this relationship key.
        const instances = await this.prisma.objectInstance.findMany({
          where: { tenantId, objectType, deletedAt: null },
          select: { relationships: true },
        });
        return instances.filter((i) => {
          const rels = i.relationships as Record<string, unknown> | null;
          const v = rels?.[change.field ?? ''];
          return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null;
        }).length;
      }

      default:
        return 0;
    }
  }

  /**
   * Apply the tenant's Draft to production and discard the Draft. FK-safe ordering:
   * drop relationships → drop types → upsert types → create relationships (so a type
   * referenced by a new relationship already exists, and a dropped type's relationships
   * are gone first).
   *
   * Informed gate (ADR-0031): if the preflight finds any breaking change, the publish is
   * refused unless `confirmed` is true — the OPC must have seen the impact counts first.
   * Safe-only publishes proceed without a prompt.
   */
  async publish(tenantId: string, opts: { confirmed?: boolean } = {}): Promise<PublishResult> {
    const draft = await this.draftService.getDraftOrThrow(tenantId);
    const rows = await this.loadPublishedRows(tenantId);

    const preflight = await this.preflightFrom(tenantId, rows, draft.snapshot);
    if (preflight.hasBreaking && !opts.confirmed) {
      throw new BadRequestException({
        message: '发布包含破坏性变更，需要在确认影响后显式确认（confirmed: true）。',
        code: 'PUBLISH_REQUIRES_CONFIRMATION',
        changes: preflight.changes,
      });
    }

    const plan = flattenSnapshot(rows, draft.snapshot);
    const reconcileTargets: Array<{ id: string; name: string; type: SnapshotObjectType }> = [];

    await this.prisma.$transaction(async (tx) => {
      for (const rel of plan.deleteRelationships) {
        await tx.objectRelationship.delete({ where: { id: rel.id } });
      }
      for (const t of plan.deleteTypes) {
        // Schema-only: drop the type definition; instances are left untouched (ADR-0031).
        await tx.objectTypeIndex.deleteMany({ where: { objectTypeId: t.id } });
        await tx.objectType.delete({ where: { id: t.id } });
      }
      for (const t of plan.createTypes) {
        const created = await tx.objectType.create({
          data: this.typeCreateData(tenantId, t),
        });
        reconcileTargets.push({ id: created.id, name: t.name, type: t });
      }
      for (const { id, type } of plan.updateTypes) {
        await tx.objectType.update({
          where: { id },
          data: {
            label: type.label,
            description: type.description ?? null,
            properties: toProductionProperties(type) as unknown as Prisma.InputJsonValue,
            derivedProperties: toProductionDerivedProperties(type) as unknown as Prisma.InputJsonValue,
            version: { increment: 1 },
          },
        });
        reconcileTargets.push({ id, name: type.name, type });
      }
      // Relationships reference types by name; resolve to ids inside the txn so newly
      // created types are visible.
      const typeIdByName = await this.typeIdMap(tx, tenantId);
      for (const rel of plan.createRelationships) {
        await tx.objectRelationship.create({
          data: {
            tenantId,
            sourceTypeId: typeIdByName.get(rel.sourceType)!,
            targetTypeId: typeIdByName.get(rel.targetType)!,
            name: rel.name,
            cardinality: rel.cardinality,
            description: rel.description ?? null,
          },
        });
      }
    });

    // Reconcile indexes + materialized views for created/updated types post-commit.
    for (const target of reconcileTargets) {
      await this.artifactManager.reconcile(
        tenantId,
        target.id,
        target.name,
        toProductionProperties(target.type),
      );
    }

    await this.draftService.discard(tenantId);

    return {
      createdTypes: plan.createTypes.map((t) => t.name),
      updatedTypes: plan.updateTypes.map((u) => u.type.name),
      deletedTypes: plan.deleteTypes.map((t) => t.name),
      createdRelationships: plan.createRelationships.map((r) => r.name),
      deletedRelationships: plan.deleteRelationships.map((r) => r.name),
    };
  }

  private typeCreateData(tenantId: string, t: SnapshotObjectType): Prisma.ObjectTypeUncheckedCreateInput {
    return {
      tenantId,
      name: t.name,
      label: t.label,
      description: t.description ?? null,
      properties: toProductionProperties(t) as unknown as Prisma.InputJsonValue,
      derivedProperties: toProductionDerivedProperties(t) as unknown as Prisma.InputJsonValue,
    };
  }

  private async typeIdMap(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<Map<string, string>> {
    const rows = await tx.objectType.findMany({ where: { tenantId }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.name, r.id]));
  }

  private async loadPublishedRows(tenantId: string): Promise<OntologyRowSet> {
    const [types, relationships] = await Promise.all([
      this.prisma.objectType.findMany({ where: { tenantId } }),
      this.prisma.objectRelationship.findMany({
        where: { tenantId },
        include: { sourceType: true, targetType: true },
      }),
    ]);
    return {
      types: types.map((t) => ({
        id: t.id,
        name: t.name,
        label: t.label,
        description: t.description,
        properties: t.properties,
        derivedProperties: t.derivedProperties,
      })),
      relationships: relationships.map((r) => ({
        id: r.id,
        name: r.name,
        sourceTypeName: r.sourceType.name,
        targetTypeName: r.targetType.name,
        cardinality: r.cardinality,
        description: r.description,
      })),
    };
  }
}
