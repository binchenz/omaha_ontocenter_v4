import { Injectable, ForbiddenException } from '@nestjs/common';

@Injectable()
export class PermissionService {
  canAccess(permissions: string[], resource: string, action: string): boolean {
    return permissions.some((p) => {
      if (p === '*') return true;
      const base = p.split(':')[0];
      const [res, act] = base.split('.');
      if (res === resource && (act === '*' || act === action)) return true;
      return false;
    });
  }

  assertCanAccess(permissions: string[], resource: string, action: string): void {
    if (!this.canAccess(permissions, resource, action)) {
      throw new ForbiddenException(`No permission for ${resource}.${action}`);
    }
  }

  getAllowedFields(
    permissions: string[],
    resource: string,
    action: string,
  ): Set<string> | null {
    const fields = new Set<string>();
    for (const p of permissions) {
      if (p === '*') return null;
      const base = p.split(':')[0];
      const [res, act] = base.split('.');
      if (res !== resource) continue;
      if (act !== '*' && act !== action) continue;
      const colonIdx = p.indexOf(':');
      if (colonIdx !== -1) {
        for (const field of p.substring(colonIdx + 1).split(',')) {
          fields.add(field.trim());
        }
      }
    }
    return fields.size > 0 ? fields : null;
  }

  filterFields(
    properties: Record<string, unknown>,
    allowedFields: Set<string> | null,
  ): Record<string, unknown> {
    if (!allowedFields) return properties;
    const filtered: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (field in properties) filtered[field] = properties[field];
    }
    return filtered;
  }
}
