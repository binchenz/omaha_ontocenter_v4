import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from './tool.interface';
import { ConnectorSdk } from '../connector/connector.sdk';

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
    additionalProperties: false,
  };
  requiresConfirmation = false;

  constructor(private readonly sdk: ConnectorSdk) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    return this.sdk.previewDbTable(context.user.tenantId, args.connectorId as string, args.tableName as string);
  }
}
