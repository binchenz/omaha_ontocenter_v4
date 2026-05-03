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

  filterFields(
    properties: Record<string, unknown>,
    permissions: string[],
  ): Record<string, unknown> {
    if (permissions.includes('*')) return properties;

    const allowedFields = this.extractAllowedFields(permissions);
    if (!allowedFields) return properties;

    const filtered: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (field in properties) filtered[field] = properties[field];
    }
    return filtered;
  }

  private extractAllowedFields(permissions: string[]): string[] | null {
    for (const p of permissions) {
      const colonIdx = p.indexOf(':');
      if (colonIdx !== -1) {
        return p.substring(colonIdx + 1).split(',');
      }
    }
    return null;
  }
}
