import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from './tool.interface';
import { PrismaService } from '@omaha/db';
import { ConnectorClient } from '../connector/connector-client.service';

@Injectable()
export class CreateConnectorTool implements AgentTool {
  name = 'create_connector';
  description = '保存数据库连接配置。密码会加密存储。';
  parameters = {
    type: 'object',
    properties: {
      name: { type: 'string', description: '连接名称（如"生产数据库"）' },
      type: { type: 'string', enum: ['mysql', 'postgresql'] },
      host: { type: 'string' },
      port: { type: 'number' },
      user: { type: 'string' },
      password: { type: 'string' },
      database: { type: 'string' },
    },
    required: ['name', 'type', 'host', 'port', 'user', 'password', 'database'],
  };
  requiresConfirmation = true;

  constructor(
    private readonly prisma: PrismaService,
    private readonly connectorClient: ConnectorClient,
  ) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const { name, type, host, port, user, password, database } = args as {
      name: string; type: string; host: string; port: number; user: string; password: string; database: string;
    };

    const encryptedPassword = this.connectorClient.encrypt(password);

    const connector = await this.prisma.connector.create({
      data: {
        tenantId: context.user.tenantId,
        name,
        type,
        config: { host, port, user, password: encryptedPassword, database } as any,
        status: 'active',
      },
    });

    return { id: connector.id, name: connector.name, message: `连接器"${name}"已创建。` };
  }
}
