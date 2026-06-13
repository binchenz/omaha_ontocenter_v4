import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService, TransformConfig } from '@omaha/db';
import { TRANSFORM_CONFIG_SCHEMAS, TransformConfigType } from './transform-config.schemas';

export type { TransformConfigType };

export interface CreateTransformConfigDto {
  name: string;
  type: TransformConfigType;
  config: Record<string, unknown>;
}

@Injectable()
export class TransformConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateTransformConfigDto): Promise<TransformConfig> {
    const schema = TRANSFORM_CONFIG_SCHEMAS[dto.type];
    if (!schema) {
      throw new BadRequestException(`Unknown TransformConfig type: ${dto.type}`);
    }
    const parsed = schema.safeParse(dto.config);
    if (!parsed.success) {
      throw new BadRequestException(
        `Invalid ${dto.type} config: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      );
    }

    const latest = await this.prisma.transformConfig.findFirst({
      where: { tenantId, name: dto.name },
      orderBy: { version: 'desc' },
    });
    const version = (latest?.version ?? 0) + 1;
    return this.prisma.transformConfig.create({
      data: { tenantId, name: dto.name, type: dto.type, config: dto.config as object, version },
    });
  }

  /** Fetch a config by name. Returns the latest version unless a specific version is given (ADR-0054 version-bound lookup). */
  async get(tenantId: string, name: string, version?: number): Promise<TransformConfig> {
    const found = await this.prisma.transformConfig.findFirst({
      where: { tenantId, name, ...(version !== undefined ? { version } : {}) },
      orderBy: { version: 'desc' },
    });
    if (!found) {
      throw new NotFoundException(
        `TransformConfig ${name}${version !== undefined ? ` v${version}` : ''} not found`,
      );
    }
    return found;
  }

  /** List the latest version of each named config for a tenant (powers the list_transform_configs Agent tool, Q10). */
  async list(tenantId: string): Promise<TransformConfig[]> {
    const all = await this.prisma.transformConfig.findMany({
      where: { tenantId },
      orderBy: { version: 'desc' },
    });
    const latestByName = new Map<string, TransformConfig>();
    for (const c of all) {
      const seen = latestByName.get(c.name);
      if (!seen || c.version > seen.version) latestByName.set(c.name, c);
    }
    return [...latestByName.values()];
  }
}
