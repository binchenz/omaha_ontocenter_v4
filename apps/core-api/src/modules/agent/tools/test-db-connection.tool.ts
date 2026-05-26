import { Injectable } from '@nestjs/common';
import { AgentTool } from './tool.interface';
import { CoreSdkService } from '../../sdk/core-sdk.service';

@Injectable()
export class TestDbConnectionTool implements AgentTool {
  name = 'test_db_connection';
  description = '测试数据库连接是否可用。支持 MySQL 和 PostgreSQL。';
  parameters = {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['mysql', 'postgresql'], description: '数据库类型' },
      host: { type: 'string' },
      port: { type: 'number' },
      user: { type: 'string' },
      password: { type: 'string' },
      database: { type: 'string' },
    },
    required: ['type', 'host', 'port', 'user', 'password', 'database'],
  };
  requiresConfirmation = false;

  constructor(private readonly sdk: CoreSdkService) {}

  async execute(args: Record<string, unknown>): Promise<unknown> {
    return this.sdk.testDbConnection(args as any);
  }
}
