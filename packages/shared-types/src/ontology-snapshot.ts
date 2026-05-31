import type {
  Cardinality,
  DerivedPropertyDefinition,
  PropertyDefinition,
} from './ontology';

/**
 * Provenance of a reverse-inferred element (ADR-0032):
 * - `metadata`  — hard: from a DB-enforced constraint (FK, declared column type, NOT NULL)
 * - `heuristic` — guessed: from naming convention or value sampling (incl. LLM annotation)
 * - `candidate` — feasible-but-not-intent (e.g. a UNIQUE column proposed as a business key)
 *
 * A snapshot-only tag: it never reaches the production `object_types` tables.
 */
export type Provenance = 'metadata' | 'heuristic' | 'candidate';

export interface SnapshotProperty extends PropertyDefinition {
  provenance?: Provenance;
  /** True when `allowedValues` were inferred by sampling and the OPC must confirm completeness (#74). */
  allowedValuesUnconfirmed?: boolean;
}

export interface SnapshotDerivedProperty extends DerivedPropertyDefinition {
  provenance?: Provenance;
  /** Present for shape-compatibility with SnapshotProperty; not meaningful on derived props. */
  allowedValuesUnconfirmed?: boolean;
}

export interface SnapshotObjectType {
  name: string;
  label: string;
  description?: string;
  properties: SnapshotProperty[];
  derivedProperties: SnapshotDerivedProperty[];
  /** UNIQUE-indexed columns offered as externalId candidates; OPC picks one (#71/#74). Snapshot-only. */
  externalIdCandidates?: string[];
  /** The business key the OPC selected from `externalIdCandidates` (#74). Snapshot-only. */
  externalId?: string;
  provenance?: Provenance;
}

export interface SnapshotRelationship {
  name: string;
  /** Source object-type *name* (snapshots are ID-independent so they stay portable across tenants). */
  sourceType: string;
  targetType: string;
  cardinality: Cardinality;
  description?: string;
  provenance?: Provenance;
}

export const ONTOLOGY_SNAPSHOT_VERSION = 1 as const;

export interface OntologySnapshot {
  version: typeof ONTOLOGY_SNAPSHOT_VERSION;
  objectTypes: SnapshotObjectType[];
  relationships: SnapshotRelationship[];
}

/**
 * Codec for the canonical ontology-snapshot wire form. `encode` produces a plain
 * JSON-safe value (ready for a Prisma JSON column); `decode` parses an unknown JSON
 * value back into a normalized snapshot, dropping unknown keys and filling defaults.
 *
 * Pure and dependency-free (same contract as validate-instance.ts) so the snapshot
 * format is fixed once and reused by Snapshotter, reverse-inference, templates, and
 * publish. Round-trips losslessly for every field this format defines, including
 * provenance tags.
 */
export const OntologySnapshotCodec = {
  encode(snapshot: OntologySnapshot): unknown {
    // Re-decode to guarantee the encoded value is normalized and JSON-clean.
    const normalized = OntologySnapshotCodec.decode(snapshot);
    return JSON.parse(JSON.stringify(normalized));
  },

  decode(raw: unknown): OntologySnapshot {
    const obj = isRecord(raw) ? raw : {};
    return {
      version: ONTOLOGY_SNAPSHOT_VERSION,
      objectTypes: asArray(obj.objectTypes).map(decodeObjectType),
      relationships: asArray(obj.relationships).map(decodeRelationship),
    };
  },
};

function decodeObjectType(raw: unknown): SnapshotObjectType {
  const o = isRecord(raw) ? raw : {};
  const ot: SnapshotObjectType = {
    name: str(o.name),
    label: str(o.label) || str(o.name),
    properties: asArray(o.properties).map(decodeProperty),
    derivedProperties: asArray(o.derivedProperties).map(decodeDerivedProperty),
  };
  if (o.description !== undefined) ot.description = str(o.description);
  const cands = asArray(o.externalIdCandidates).map((c) => str(c)).filter((c) => c !== '');
  if (cands.length > 0) ot.externalIdCandidates = cands;
  if (o.externalId !== undefined && str(o.externalId) !== '') ot.externalId = str(o.externalId);
  const prov = provenance(o.provenance);
  if (prov) ot.provenance = prov;
  return ot;
}

function decodeProperty(raw: unknown): SnapshotProperty {
  const p = isRecord(raw) ? raw : {};
  const prop: SnapshotProperty = {
    name: str(p.name),
    label: str(p.label) || str(p.name),
    type: propertyType(p.type),
  };
  copyPropertyExtras(p, prop);
  const prov = provenance(p.provenance);
  if (prov) prop.provenance = prov;
  if (p.allowedValuesUnconfirmed === true) prop.allowedValuesUnconfirmed = true;
  return prop;
}

function decodeDerivedProperty(raw: unknown): SnapshotDerivedProperty {
  const base = decodeProperty(raw) as SnapshotDerivedProperty;
  const d = isRecord(raw) ? raw : {};
  base.expression = str(d.expression);
  const params = asArray(d.params)
    .map((param) => {
      const pr = isRecord(param) ? param : {};
      return { name: str(pr.name), type: derivedParamType(pr.type) };
    })
    .filter((param) => param.name !== '');
  if (params.length > 0) base.params = params;
  return base;
}

function decodeRelationship(raw: unknown): SnapshotRelationship {
  const r = isRecord(raw) ? raw : {};
  const rel: SnapshotRelationship = {
    name: str(r.name),
    sourceType: str(r.sourceType),
    targetType: str(r.targetType),
    cardinality: cardinality(r.cardinality),
  };
  if (r.description !== undefined) rel.description = str(r.description);
  const prov = provenance(r.provenance);
  if (prov) rel.provenance = prov;
  return rel;
}

/** Copy the optional PropertyDefinition fields verbatim, preserving only well-formed values. */
function copyPropertyExtras(src: Record<string, unknown>, dst: SnapshotProperty): void {
  if (src.required === true) dst.required = true;
  if (src.filterable === true) dst.filterable = true;
  if (src.sortable === true) dst.sortable = true;
  if (typeof src.precision === 'number') dst.precision = src.precision;
  if (typeof src.scale === 'number') dst.scale = src.scale;
  if (src.description !== undefined) dst.description = str(src.description);
  if (src.unit !== undefined) dst.unit = str(src.unit);
  if (Array.isArray(src.allowedValues)) {
    const vals = src.allowedValues.map((v) => String(v));
    if (vals.length > 0) dst.allowedValues = vals;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
}
function propertyType(v: unknown): PropertyDefinition['type'] {
  return v === 'number' || v === 'boolean' || v === 'date' || v === 'json' ? v : 'string';
}
function derivedParamType(v: unknown): NonNullable<DerivedPropertyDefinition['params']>[number]['type'] {
  return v === 'datetime' || v === 'decimal' || v === 'int' || v === 'boolean' ? v : 'string';
}
function cardinality(v: unknown): Cardinality {
  return v === 'one-to-one' || v === 'many-to-many' ? v : 'one-to-many';
}
function provenance(v: unknown): Provenance | undefined {
  return v === 'metadata' || v === 'heuristic' || v === 'candidate' ? v : undefined;
}

