import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const tenantId = request.params.tenantId || request.body?.tenantId || request.query?.tenantId;
    if (tenantId && tenantId !== user.tenantId) {
      throw new ForbiddenException('Access denied to this tenant');
    }
    return true;
  }
}
