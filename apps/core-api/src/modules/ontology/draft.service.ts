import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService, Prisma } from '@omaha/db';
import {
  OntologySnapshotCodec,
  rowsToSnapshot,
  validateSnapshot,
  type OntologyRowSet,
  type OntologySnapshot,
} from '@omaha/shared-types';
import { OntologyService } from './ontology.service';

export interface DraftRecord {
  tenantId: string;
  snapshot: OntologySnapshot;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * CRUD over the `ontology_drafts` table (ADR-0031): at most one Draft row per tenant
 * holding a JSON snapshot of the whole ontology. Create-from-published seeds the
 * Draft from the live tables via the pure Snapshotter; mutate/overwrite write the
 * snapshot back; discard deletes the row. This service never touches the production
 * `object_types`/`object_relationships` tables — only PublishService does, at publish.
 */
@Injectable()
export class DraftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ontology: OntologyService,
  ) {}

  /** Snapshot the live published ontology into normalized snapshot form (Snapshotter). */
  async snapshotPublished(tenantId: string): Promise<OntologySnapshot> {
    const [types, relationships] = await Promise.all([
      this.ontology.listObjectTypes(tenantId),
      this.ontology.listRelationships(tenantId),
    ]);
    const rows: OntologyRowSet = {
      types: types.map((t) => ({
        id: t.id,
        name: t.name,
        label: t.label,
        description: t.description,
        properties: t.properties,
        derivedProperties: t.derivedProperties,
      })),
      relationships: relationships.map((r: any) => ({
        id: r.id,
        name: r.name,
        sourceTypeName: r.sourceType.name,
        targetTypeName: r.targetType.name,
        cardinality: r.cardinality,
        description: r.description,
      })),
    };
    return rowsToSnapshot(rows);
  }

  /** Return the current Draft, or null if none exists. */
  async getDraft(tenantId: string): Promise<DraftRecord | null> {
    const row = await this.prisma.ontologyDraft.findUnique({ where: { tenantId } });
    if (!row) return null;
    return this.toRecord(row);
  }

  async getDraftOrThrow(tenantId: string): Promise<DraftRecord> {
    const draft = await this.getDraft(tenantId);
    if (!draft) throw new NotFoundException('当前租户没有草稿，请先从已发布本体创建草稿。');
    return draft;
  }

  /**
   * Create a Draft by snapshotting the published ontology. If a Draft already exists,
   * returns it unchanged (exactly one Draft per tenant — the model stays simple, and
   * re-creating must not silently clobber accumulated edits; callers discard first).
   */
  async createFromPublished(tenantId: string): Promise<DraftRecord> {
    const existing = await this.getDraft(tenantId);
    if (existing) return existing;
    const snapshot = await this.snapshotPublished(tenantId);
    return this.upsertSnapshot(tenantId, snapshot);
  }

  /** Overwrite the Draft snapshot (used by editing, reverse-inference, template apply). */
  async upsertSnapshot(tenantId: string, snapshot: OntologySnapshot): Promise<DraftRecord> {
    const normalized = OntologySnapshotCodec.decode(OntologySnapshotCodec.encode(snapshot));
    const errors = validateSnapshot(normalized);
    if (errors.length > 0) {
      throw new BadRequestException(
        `草稿校验失败：${errors.map((e) => `[${e.path}] ${e.message}`).join('；')}`,
      );
    }
    const encoded = OntologySnapshotCodec.encode(normalized) as Prisma.InputJsonValue;
    const row = await this.prisma.ontologyDraft.upsert({
      where: { tenantId },
      create: { tenantId, snapshot: encoded, status: 'editing' },
      update: { snapshot: encoded, status: 'editing' },
    });
    return this.toRecord(row);
  }

  /**
   * Replace the snapshot of an EXISTING Draft (the workbench edit path). Requires a
   * Draft to exist — editing without first creating one is a 404, so the OPC always
   * edits against an explicit snapshot of the published baseline.
   */
  async replaceSnapshot(tenantId: string, snapshot: OntologySnapshot): Promise<DraftRecord> {
    await this.getDraftOrThrow(tenantId);
    return this.upsertSnapshot(tenantId, snapshot);
  }

  /** Discard the Draft (rollback). No-op if none exists. */
  async discard(tenantId: string): Promise<void> {
    await this.prisma.ontologyDraft.deleteMany({ where: { tenantId } });
  }

  private toRecord(row: {
    tenantId: string;
    snapshot: unknown;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }): DraftRecord {
    return {
      tenantId: row.tenantId,
      snapshot: OntologySnapshotCodec.decode(row.snapshot),
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
