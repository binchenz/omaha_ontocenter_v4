export interface ParentScope {
  kind: 'parent';
  tenantId: string;
  objectType: string;
  includeDeleted?: boolean;
}

export interface ChildScope {
  kind: 'child';
  tenantId: string;
  objectType: string;
  foreignKey: string;
  parentAlias: string;
  includeDeleted?: boolean;
}

export type ObjectInstanceScope = ParentScope | ChildScope;

export function parentScope(args: {
  tenantId: string;
  objectType: string;
  includeDeleted?: boolean;
}): ParentScope {
  return { kind: 'parent', ...args };
}

export function childScope(args: {
  tenantId: string;
  objectType: string;
  foreignKey: string;
  parentAlias: string;
  includeDeleted?: boolean;
}): ChildScope {
  return { kind: 'child', ...args };
}

export interface EmittedScope {
  sql: string;
  params: unknown[];
}

export function emitScope(scope: ObjectInstanceScope): EmittedScope {
  if (scope.kind === 'parent') {
    const params: unknown[] = [scope.tenantId, scope.objectType];
    const pieces = [`tenant_id = $1::uuid`, `object_type = $2`];
    if (!scope.includeDeleted) pieces.push(`deleted_at IS NULL`);
    return { sql: `FROM object_instances WHERE ${pieces.join(' AND ')}`, params };
  }
  const params: unknown[] = [scope.objectType];
  const pieces = [
    `child.tenant_id = ${scope.parentAlias}.tenant_id`,
    `child.object_type = $1`,
  ];
  if (!scope.includeDeleted) pieces.push(`child.deleted_at IS NULL`);
  pieces.push(
    `(child.relationships->>'${scope.foreignKey}') = ${scope.parentAlias}.id::text`,
  );
  return { sql: `FROM object_instances child WHERE ${pieces.join(' AND ')}`, params };
}
