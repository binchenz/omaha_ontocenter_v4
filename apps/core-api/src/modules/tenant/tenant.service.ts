import { Injectable } from '@nestjs/common';
import { PrismaService, Tenant } from '@omaha/db';

@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Tenant | null> {
    return this.prisma.tenant.findUnique({ where: { id } });
  }

  async updateSettings(id: string, settings: Record<string, unknown>): Promise<Tenant> {
    return this.prisma.tenant.update({
      where: { id },
      data: { settings: settings as object },
    });
  }
}
