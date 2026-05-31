import type {
  DerivedPropertyDefinition,
  PropertyDefinition,
} from './ontology';
import {
  ONTOLOGY_SNAPSHOT_VERSION,
  OntologySnapshotCodec,
  type OntologySnapshot,
  type SnapshotObjectType,
  type SnapshotRelationship,
} from './ontology-snapshot';

/**
 * Abstract row shapes for the live, normalized ontology tables. Deliberately NOT
 * the Prisma types — keeping the Snapshotter/Flattener pure over a plain shape makes
 * them unit-testable without a database (prior art: scoped-where.spec.ts), and keeps
 * the snapshot↔rows transform the single point that must stay structurally in sync
 * with publish (ADR-0031).
 */
export interface OntologyTypeRow {
  id: string;
  name: string;
  label: string;
  description?: string | null;
  properties: unknown;
  derivedProperties: unknown;
}

export interface OntologyRelationshipRow {
  id: string;
  name: string;
  sourceTypeName: string;
  targetTypeName: string;
  cardinality: string;
  description?: string | null;
}

export interface OntologyRowSet {
  types: OntologyTypeRow[];
  relationships: OntologyRelationshipRow[];
}

/**
 * Snapshotter: normalized rows → canonical snapshot. Drops DB ids (snapshots are
 * id-independent so they stay portable across tenants/templates) and decodes the
 * JSON property payloads through the codec so the output is always normalized.
 */
export function rowsToSnapshot(rows: OntologyRowSet): OntologySnapshot {
  return OntologySnapshotCodec.decode({
    version: ONTOLOGY_SNAPSHOT_VERSION,
    objectTypes: rows.types.map((t) => ({
      name: t.name,
      label: t.label,
      description: t.description ?? undefined,
      properties: asArray(t.properties),
      derivedProperties: asArray(t.derivedProperties),
    })),
    relationships: rows.relationships.map((r) => ({
      name: r.name,
      sourceType: r.sourceTypeName,
      targetType: r.targetTypeName,
      cardinality: r.cardinality,
      description: r.description ?? undefined,
    })),
  });
}

/** The production-table mutation set a publish must apply, in dependency-safe groupings. */
export interface FlattenPlan {
  createTypes: SnapshotObjectType[];
  updateTypes: Array<{ id: string; type: SnapshotObjectType }>;
  deleteTypes: Array<{ id: string; name: string }>;
  createRelationships: SnapshotRelationship[];
  deleteRelationships: Array<{ id: string; name: string; sourceType: string }>;
}

/**
 * Flattener: draft snapshot + current published rows → the row operations that make
 * production match the draft. Pure: it resolves create-vs-update by name and carries
 * existing ids for updates/deletes, but performs no IO. The executor (PublishService)
 * applies the plan in a transaction, ordering deletes-before-type-deletes for FK
 * safety. Property/relationship *values* in createTypes/updateTypes are the draft's;
 * provenance and other snapshot-only tags are stripped when written (the executor
 * maps to the production property shape).
 */
export function flattenSnapshot(published: OntologyRowSet, draft: OntologySnapshot): FlattenPlan {
  const pubTypeById = new Map(published.types.map((t) => [t.name, t]));
  const draftTypeNames = new Set(draft.objectTypes.map((t) => t.name));

  const createTypes: SnapshotObjectType[] = [];
  const updateTypes: Array<{ id: string; type: SnapshotObjectType }> = [];
  for (const dt of draft.objectTypes) {
    const existing = pubTypeById.get(dt.name);
    if (existing) updateTypes.push({ id: existing.id, type: dt });
    else createTypes.push(dt);
  }
  const deleteTypes = published.types
    .filter((t) => !draftTypeNames.has(t.name))
    .map((t) => ({ id: t.id, name: t.name }));

  const relKey = (sourceType: string, name: string) => `${sourceType}::${name}`;
  const pubRelByKey = new Map(
    published.relationships.map((r) => [relKey(r.sourceTypeName, r.name), r]),
  );
  const draftRelKeys = new Set(draft.relationships.map((r) => relKey(r.sourceType, r.name)));

  const createRelationships = draft.relationships.filter(
    (r) => !pubRelByKey.has(relKey(r.sourceType, r.name)),
  );
  const deleteRelationships = published.relationships
    .filter((r) => !draftRelKeys.has(relKey(r.sourceTypeName, r.name)))
    .map((r) => ({ id: r.id, name: r.name, sourceType: r.sourceTypeName }));

  return { createTypes, updateTypes, deleteTypes, createRelationships, deleteRelationships };
}

/** Strip snapshot-only tags, yielding the production PropertyDefinition[] for writing. */
export function toProductionProperties(type: SnapshotObjectType): PropertyDefinition[] {
  return type.properties.map((p) => {
    const { provenance, allowedValuesUnconfirmed, ...rest } = p;
    return rest as PropertyDefinition;
  });
}

export function toProductionDerivedProperties(type: SnapshotObjectType): DerivedPropertyDefinition[] {
  return type.derivedProperties.map((d) => {
    const { provenance, allowedValuesUnconfirmed, ...rest } = d;
    return rest as DerivedPropertyDefinition;
  });
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
