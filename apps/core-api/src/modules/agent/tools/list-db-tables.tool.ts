import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from './tool.interface';
import { ConnectorSdk } from '../connector/connector.sdk';

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
    additionalProperties: false,
  };
  requiresConfirmation = false;

  constructor(private readonly sdk: ConnectorSdk) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    return this.sdk.listDbTables(context.user.tenantId, args.connectorId as string);
  }
}
