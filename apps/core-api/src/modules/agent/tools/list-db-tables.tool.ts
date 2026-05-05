import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from './tool.interface';
import { ConnectorClient } from '../connector/connector-client.service';

@Injectable()
export class ListDbTablesTool implements AgentTool {
  name = 'list_db_tables';
  description = '列出数据库中的业务表（排除系统表）。';
  parameters = {
    type: 'object',
    properties: {
      connectorId: { type: 'string', description: '连接器 ID' },
    },
    required: ['connectorId'],
  };
  requiresConfirmation = false;

  constructor(private readonly connectorClient: ConnectorClient) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    try {
      const connector = await this.connectorClient.getConnection(args.connectorId as string, context.user.tenantId);

      const sql = connector.type === 'postgresql'
        ? "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
        : 'SELECT table_name FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name';
      const params = connector.type === 'postgresql' ? undefined : [connector.config.database];

      const rows = await this.connectorClient.query(connector, sql, params);
      return { tables: rows.map((r: any) => r.table_name || r.TABLE_NAME) };
    } catch (err: any) {
      return { error: err.message };
    }
  }
}
