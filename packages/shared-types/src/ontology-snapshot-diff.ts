import type {
  OntologySnapshot,
  SnapshotObjectType,
  SnapshotProperty,
  SnapshotRelationship,
} from './ontology-snapshot';

/**
 * A single schema change between the published ontology and a draft snapshot.
 * `kind` names the change; `tier` (safe | breaking) is assigned by the classifier
 * per the ADR-0031 rule table. Breaking changes carry an `impactCount` once the
 * publish preflight has scanned existing instances (#73); the pure differ leaves
 * it undefined.
 */
export type SnapshotChangeKind =
  | 'add-type'
  | 'drop-type'
  | 'add-field'
  | 'drop-field'
  | 'change-field-type'
  | 'restrict-allowed-values'
  | 'edit-field-meta'
  | 'toggle-capability'
  | 'add-relationship'
  | 'drop-relationship';

export type SnapshotChangeTier = 'safe' | 'breaking';

export interface SnapshotChange {
  kind: SnapshotChangeKind;
  tier: SnapshotChangeTier;
  /** Object-type name (for type/field/capability changes) or relationship source type. */
  objectType: string;
  /** Field name for field-level changes; relationship name for relationship changes. */
  field?: string;
  detail: string;
  /** Affected existing-instance count, filled by the publish preflight for breaking changes (#73). */
  impactCount?: number;
}

/** Per-change kind → tier. The single source of truth for the safe/breaking line (ADR-0031). */
const CHANGE_TIER: Record<SnapshotChangeKind, SnapshotChangeTier> = {
  'add-type': 'safe',
  'add-field': 'safe',
  'add-relationship': 'safe',
  'edit-field-meta': 'safe',
  'toggle-capability': 'safe',
  'drop-type': 'breaking',
  'drop-field': 'breaking',
  'change-field-type': 'breaking',
  'restrict-allowed-values': 'breaking',
  'drop-relationship': 'breaking',
};

function change(
  kind: SnapshotChangeKind,
  objectType: string,
  detail: string,
  field?: string,
): SnapshotChange {
  return { kind, tier: CHANGE_TIER[kind], objectType, field, detail };
}

/**
 * Pure structural diff of a draft snapshot against the live published ontology
 * (itself in snapshot form via the Snapshotter). Returns the change list with each
 * change classified safe/breaking. Does NOT read instance data — `impactCount` is
 * filled later by the publish preflight (#73). Two tiers only; no hard-block tier,
 * because the OPC is the trusted single-tenant operator (ADR-0031).
 *
 * `restrict-allowed-values` covers both adding a constraint where none existed and
 * tightening an existing one (removing a previously-legal value): both can orphan
 * existing instance values, so both are breaking and impact-counted.
 */
export function diffSnapshots(
  published: OntologySnapshot,
  draft: OntologySnapshot,
): SnapshotChange[] {
  const changes: SnapshotChange[] = [];
  const pubTypes = byName(published.objectTypes);
  const draftTypes = byName(draft.objectTypes);

  for (const [name, dt] of draftTypes) {
    const pt = pubTypes.get(name);
    if (!pt) {
      changes.push(change('add-type', name, `新增对象类型「${dt.label || name}」`));
      continue;
    }
    diffProperties(name, pt, dt, changes);
  }
  for (const [name, pt] of pubTypes) {
    if (!draftTypes.has(name)) {
      changes.push(change('drop-type', name, `删除对象类型「${pt.label || name}」`));
    }
  }

  diffRelationships(published.relationships, draft.relationships, changes);
  return changes;
}

function diffProperties(
  typeName: string,
  pub: SnapshotObjectType,
  draft: SnapshotObjectType,
  changes: SnapshotChange[],
): void {
  const pubProps = byName(pub.properties);
  const draftProps = byName(draft.properties);

  for (const [fname, dp] of draftProps) {
    const pp = pubProps.get(fname);
    if (!pp) {
      changes.push(change('add-field', typeName, `新增字段「${dp.label || fname}」`, fname));
      continue;
    }
    diffSingleProperty(typeName, fname, pp, dp, changes);
  }
  for (const [fname, pp] of pubProps) {
    if (!draftProps.has(fname)) {
      changes.push(change('drop-field', typeName, `删除字段「${pp.label || fname}」`, fname));
    }
  }
}

function diffSingleProperty(
  typeName: string,
  fname: string,
  pp: SnapshotProperty,
  dp: SnapshotProperty,
  changes: SnapshotChange[],
): void {
  if (pp.type !== dp.type) {
    changes.push(
      change('change-field-type', typeName, `字段「${fname}」类型 ${pp.type} → ${dp.type}`, fname),
    );
  }
  const restricted = restrictsAllowedValues(pp.allowedValues, dp.allowedValues);
  if (restricted) {
    changes.push(change('restrict-allowed-values', typeName, restricted, fname));
  }
  if (pp.label !== dp.label || (pp.description ?? '') !== (dp.description ?? '') || (pp.unit ?? '') !== (dp.unit ?? '')) {
    changes.push(change('edit-field-meta', typeName, `编辑字段「${fname}」的标注（标签/描述/单位）`, fname));
  }
  if (!!pp.filterable !== !!dp.filterable || !!pp.sortable !== !!dp.sortable) {
    changes.push(change('toggle-capability', typeName, `切换字段「${fname}」的可过滤/可排序`, fname));
  }
}

/**
 * Detect a tightening of the controlled value set: a constraint added where none
 * existed, or any previously-legal value removed. Widening (adding values) or an
 * unchanged set is not a restriction. Returns a human detail string, or null.
 */
function restrictsAllowedValues(pub?: string[], draft?: string[]): string | null {
  if (!draft || draft.length === 0) return null; // dropping the constraint is a widening
  if (!pub || pub.length === 0) {
    return `字段新增取值约束 allowedValues=[${draft.join('|')}]`;
  }
  const draftSet = new Set(draft);
  const removed = pub.filter((v) => !draftSet.has(v));
  if (removed.length === 0) return null;
  return `字段收紧取值约束，移除 [${removed.join('|')}]`;
}

function diffRelationships(
  pub: SnapshotRelationship[],
  draft: SnapshotRelationship[],
  changes: SnapshotChange[],
): void {
  const key = (r: SnapshotRelationship) => `${r.sourceType}::${r.name}`;
  const pubRels = new Map(pub.map((r) => [key(r), r]));
  const draftRels = new Map(draft.map((r) => [key(r), r]));

  for (const [k, dr] of draftRels) {
    if (!pubRels.has(k)) {
      changes.push(change('add-relationship', dr.sourceType, `新增关系「${dr.name}」(${dr.sourceType}→${dr.targetType})`, dr.name));
    }
  }
  for (const [k, pr] of pubRels) {
    if (!draftRels.has(k)) {
      changes.push(change('drop-relationship', pr.sourceType, `删除关系「${pr.name}」(${pr.sourceType}→${pr.targetType})`, pr.name));
    }
  }
}

function byName<T extends { name: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((i) => [i.name, i]));
}

/** True when the diff contains at least one breaking change (gate trigger for #73). */
export function hasBreakingChange(changes: SnapshotChange[]): boolean {
  return changes.some((c) => c.tier === 'breaking');
}
