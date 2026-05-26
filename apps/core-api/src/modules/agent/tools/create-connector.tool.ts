import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from './tool.interface';
import { CoreSdkService } from '../../sdk/core-sdk.service';

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

  constructor(private readonly sdk: CoreSdkService) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    return this.sdk.createConnector(context.user.tenantId, args as any);
  }
}
