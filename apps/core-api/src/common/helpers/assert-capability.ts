import { ForbiddenException } from '@nestjs/common';
import { CurrentUser, hasCapability } from '@omaha/shared-types';

/**
 * The single write-authz gate (ADR-0040 §4). Both entry points — the HTTP controllers
 * and the Agent's SDK path — call this one helper, over the pure `hasCapability`, so the
 * two paths share one decision and cannot drift. Pure (no DI) to avoid PermissionResolver's
 * request-scope cascade. Throws 403 if the actor lacks `resource.action`.
 */
export function assertCapability(actor: CurrentUser, resource: string, action: string): void {
  if (!hasCapability(actor.permissions ?? [], resource, action)) {
    throw new ForbiddenException(`No permission for ${resource}.${action}`);
  }
}
