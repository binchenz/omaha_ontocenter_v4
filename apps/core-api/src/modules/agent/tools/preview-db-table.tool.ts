import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from './tool.interface';
import { ConnectorClient } from '../connector/connector-client.service';

@Injectable()
export class PreviewDbTableTool implements AgentTool {
  name = 'preview_db_table';
  description = '预览数据库表的结构和前几行数据。';
  parameters = {
    type: 'object',
    properties: {
      connectorId: { type: 'string', description: '连接器 ID' },
      tableName: { type: 'string', description: '表名' },
    },
    required: ['connectorId', 'tableName'],
  };
  requiresConfirmation = false;

  constructor(private readonly connectorClient: ConnectorClient) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const tableName = args.tableName as string;

    try {
      const connector = await this.connectorClient.getConnection(args.connectorId as string, context.user.tenantId);

      if (connector.type === 'postgresql') {
        const cols = await this.connectorClient.query(
          connector,
          "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
          [tableName],
        );
        const sampleRows = await this.connectorClient.query(connector, `SELECT * FROM "${tableName}" LIMIT 5`);
        return {
          columns: cols.map((r: any) => ({ name: r.column_name, dbType: r.data_type })),
          sampleRows,
          totalEstimate: null,
        };
      }

      if (connector.type === 'mysql') {
        const cols = await this.connectorClient.query(
          connector,
          'SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position',
          [connector.config.database, tableName],
        );
        const sampleRows = await this.connectorClient.query(connector, `SELECT * FROM \`${tableName}\` LIMIT 5`);
        return {
          columns: cols.map((r: any) => ({ name: r.COLUMN_NAME || r.column_name, dbType: r.DATA_TYPE || r.data_type })),
          sampleRows,
          totalEstimate: null,
        };
      }

      return { error: `不支持的数据库类型: ${connector.type}` };
    } catch (err: any) {
      return { error: `预览失败: ${err.message}` };
    }
  }
}
