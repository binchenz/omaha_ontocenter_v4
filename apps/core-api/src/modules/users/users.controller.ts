import { Controller, Get, Post, Delete, Body, Param, UseGuards, HttpCode } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '@omaha/shared-types';
import { PrismaService } from '@omaha/db';
import { assertCapability } from '../../common/helpers/assert-capability';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserType) {
    assertCapability(user, 'users', 'manage');
    return this.users.listUsers(user.tenantId);
  }

  @Post()
  create(@CurrentUser() user: CurrentUserType, @Body() dto: { name: string; email: string; password: string; roleId: string }) {
    assertCapability(user, 'users', 'manage');
    return this.users.createUser(user.tenantId, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    assertCapability(user, 'users', 'manage');
    await this.users.deleteUser(user.tenantId, id, user.id);
  }
}

@Controller('permissions/roles')
@UseGuards(JwtAuthGuard)
export class RolesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: CurrentUserType): Promise<{ id: string; name: string; permissions: unknown }[]> {
    return this.prisma.role.findMany({
      where: { tenantId: user.tenantId },
      select: { id: true, name: true, permissions: true },
    });
  }
}
