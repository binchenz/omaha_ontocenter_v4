export interface PermissionRule {
  resource: string;
  action: string;
  fields?: string[];
  conditions?: Record<string, unknown>;
}

export function parsePermissions(raw: string[]): PermissionRule[] {
  return raw.map((p) => {
    const parts = p.split('.');
    if (p === '*') return { resource: '*', action: '*' };
    return {
      resource: parts[0],
      action: parts[1] ?? '*',
    };
  });
}

export function hasPermission(
  permissions: string[],
  resource: string,
  action: string,
): boolean {
  return permissions.some((p) => {
    if (p === '*') return true;
    const [res, act] = p.split('.');
    if (res === resource && (act === '*' || act === action)) return true;
    return false;
  });
}
