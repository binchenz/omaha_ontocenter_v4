import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import * as bcrypt from 'bcrypt';

export interface CreateUserDto { name: string; email: string; password: string; roleId: string; }
export interface UserDto { id: string; name: string; email: string; roleId: string; roleName: string; }

const USER_SELECT = { id: true, name: true, email: true, roleId: true, role: { select: { name: true } } } as const;
const toDto = (u: { id: string; name: string; email: string; roleId: string; role: { name: string } }): UserDto =>
  ({ id: u.id, name: u.name, email: u.email, roleId: u.roleId, roleName: u.role.name });

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(tenantId: string): Promise<UserDto[]> {
    const users = await this.prisma.user.findMany({ where: { tenantId }, select: USER_SELECT, orderBy: { createdAt: 'asc' } });
    return users.map(toDto);
  }

  async createUser(tenantId: string, dto: CreateUserDto): Promise<UserDto> {
    const passwordHash = await bcrypt.hash(dto.password, 10);
    try {
      const user = await this.prisma.user.create({
        data: { tenantId, name: dto.name, email: dto.email, passwordHash, roleId: dto.roleId },
        select: USER_SELECT,
      });
      return toDto(user);
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('Email already exists');
      throw e;
    }
  }

  async deleteUser(tenantId: string, userId: string, currentUserId: string): Promise<void> {
    if (userId === currentUserId) throw new BadRequestException('Cannot delete your own account');
    await this.prisma.user.delete({ where: { id: userId } });
  }
}
