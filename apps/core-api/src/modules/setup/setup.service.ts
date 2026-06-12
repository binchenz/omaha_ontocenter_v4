import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { InitializeDto } from './dto/initialize.dto';

@Injectable()
export class SetupService {
  constructor(private readonly prisma: PrismaService) {}

  async isInitialized(): Promise<boolean> {
    const count = await this.prisma.tenant.count();
    return count > 0;
  }

  async getStatus(): Promise<{ initialized: boolean; slug?: string }> {
    const initialized = await this.isInitialized();
    if (!initialized) return { initialized: false };
    const tenant = await (this.prisma.tenant as any).findFirst({ select: { slug: true } });
    return { initialized: true, slug: tenant?.slug };
  }

  async initialize(dto: InitializeDto): Promise<void> {
    if (await this.isInitialized()) throw new ConflictException('Already initialized');

    const jwtSecret = crypto.randomBytes(64).toString('hex');
    const connectorEncryptionKey = crypto.randomBytes(32).toString('hex');
    await Promise.all([
      { key: 'JWT_SECRET', value: jwtSecret },
      { key: 'CONNECTOR_ENCRYPTION_KEY', value: connectorEncryptionKey },
      { key: 'DEEPSEEK_API_KEY', value: dto.apiKey },
    ].map(s => this.prisma.systemSetting.upsert({ where: { key: s.key }, update: { value: s.value }, create: s })));

    const slug = dto.tenantName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const tenant = await this.prisma.tenant.create({ data: { name: dto.tenantName, slug } });

    const [adminRole] = await Promise.all([
      this.prisma.role.create({ data: { tenantId: tenant.id, name: 'admin', permissions: ['*'] } }),
      this.prisma.role.create({ data: { tenantId: tenant.id, name: 'operator', permissions: ['object.query'] } }),
    ]);

    const passwordHash = await bcrypt.hash(dto.adminPassword, 10);
    await this.prisma.user.create({
      data: { tenantId: tenant.id, email: dto.adminEmail, name: 'Admin', passwordHash, roleId: adminRole.id },
    });
  }

  async testLlm(apiKey: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { ok: false, error: body?.error?.message ?? `HTTP ${res.status}` };
      }
      return { ok: true };
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
