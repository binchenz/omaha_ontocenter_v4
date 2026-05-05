import { Injectable } from '@nestjs/common';
import { AgentTool } from './tool.interface';
import { ConnectorClient } from '../connector/connector-client.service';

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

  constructor(private readonly connectorClient: ConnectorClient) {}

  async execute(args: Record<string, unknown>): Promise<unknown> {
    const { type, host, port, user, password, database } = args as {
      type: string; host: string; port: number; user: string; password: string; database: string;
    };

    try {
      const sql = type === 'postgresql'
        ? "SELECT count(*) as table_count FROM information_schema.tables WHERE table_schema = 'public'"
        : 'SELECT count(*) as table_count FROM information_schema.tables WHERE table_schema = ?';
      const params = type === 'postgresql' ? undefined : [database];

      const rows = await this.connectorClient.query(
        { type, config: { host, port, user, password, database } },
        sql,
        params,
      );
      const count = (rows[0] as any).table_count;
      return { success: true, message: `连接成功！发现 ${count} 张表。` };
    } catch (err: any) {
      return { success: false, message: `连接失败: ${err.message}` };
    }
  }
}
