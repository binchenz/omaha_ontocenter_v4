/**
 * The single source of truth for the permissions → Surface mapping (ADR-0035 §1,
 * ADR-0041). Pure functions over the permission array — no DB, no request context —
 * imported by the front-end nav, the back-end Skill assembly, and the back-end
 * authorization guard, so the UX layer and the gate can never disagree.
 */

export const SURFACE = {
  CONSUME: 'consume',
  MAINTAIN: 'maintain',
  CREATE: 'create',
  PIPELINE: 'pipeline',
} as const;

export type Surface = (typeof SURFACE)[keyof typeof SURFACE];

/**
 * Named design-time permissions. A Role holding any of these is a design-time
 * (OPC / authorized SMB developer) user; the wildcard `*` grants everything.
 */
export const PERMISSION = {
  WILDCARD: '*',
  ONTOLOGY_DESIGN: 'ontology.design',
  ONTOLOGY_PUBLISH: 'ontology.publish',
  DATA_INGEST: 'data.ingest',
  EVALS_MANAGE: 'evals.manage',
  REVERSE_INFERENCE_RUN: 'reverse-inference.run',
  PIPELINE_AUTHOR: 'pipeline.author',
} as const;

const DESIGN_TIME_PERMISSIONS: string[] = [
  PERMISSION.ONTOLOGY_DESIGN,
  PERMISSION.ONTOLOGY_PUBLISH,
  PERMISSION.DATA_INGEST,
  PERMISSION.EVALS_MANAGE,
  PERMISSION.REVERSE_INFERENCE_RUN,
];

export function isDesignTimeUser(permissions: string[]): boolean {
  return permissions.some(
    (p) => p === PERMISSION.WILDCARD || DESIGN_TIME_PERMISSIONS.includes(p),
  );
}

export function surfacesFor(permissions: string[]): Surface[] {
  const surfaces: Surface[] = [SURFACE.CONSUME];
  if (isDesignTimeUser(permissions)) {
    surfaces.push(SURFACE.MAINTAIN, SURFACE.CREATE);
  }
  if (hasCapability(permissions, 'pipeline', 'author')) {
    surfaces.push(SURFACE.PIPELINE);
  }
  return surfaces;
}

/**
 * Whether a permission set grants `resource.action`. The pure core of the write-authz
 * gate (ADR-0040 §4): the wildcard `*` grants everything, a `resource.*` grants every
 * action on that resource, and an exact `resource.action` grants that action. A trailing
 * `:fields` field-scope (used by read permissions) is ignored for the capability check.
 * Pure so both the back-end guard and any caller share one decision, with no DI scope.
 */
export function hasCapability(permissions: string[], resource: string, action: string): boolean {
  return permissions.some((permission) => {
    if (permission === PERMISSION.WILDCARD) return true;
    const base = permission.split(':')[0];
    const [res, act] = base.split('.');
    if (res !== resource) return false;
    return act === '*' || act === action;
  });
}
