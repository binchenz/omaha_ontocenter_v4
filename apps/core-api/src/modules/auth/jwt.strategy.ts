import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '@omaha/db';
import { JwtPayload, CurrentUser, RolePermission } from '@omaha/shared-types';
import { JWT_SECRET, JWT_STRATEGY } from './auth.constants';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, JWT_STRATEGY) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: JWT_SECRET,
    });
  }

  async validate(payload: JwtPayload): Promise<CurrentUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        tenantId: true,
        roleId: true,
        role: { select: { name: true, permissions: true } },
      },
    });
    if (!user) {
      throw new UnauthorizedException();
    }

    const rules = toRolePermissions(user.role.permissions);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      tenantId: user.tenantId,
      roleId: user.roleId,
      roleName: user.role.name,
      permissions: rules.map((r) => r.permission),
      permissionRules: rules,
    };
  }
}

function toRolePermissions(value: unknown): RolePermission[] {
  if (!Array.isArray(value)) return [];
  const out: RolePermission[] = [];
  for (const v of value) {
    if (typeof v === 'string') out.push({ permission: v });
    else if (v && typeof v === 'object' && typeof (v as any).permission === 'string') {
      const rule: RolePermission = { permission: (v as any).permission };
      if (typeof (v as any).condition === 'string') rule.condition = (v as any).condition;
      out.push(rule);
    }
  }
  return out;
}
