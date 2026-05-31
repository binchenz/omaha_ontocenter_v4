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

function has(permissions: string[], wanted: string): boolean {
  return permissions.some((p) => p === PERMISSION.WILDCARD || p === wanted);
}

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
  if (has(permissions, PERMISSION.PIPELINE_AUTHOR)) {
    surfaces.push(SURFACE.PIPELINE);
  }
  return surfaces;
}
