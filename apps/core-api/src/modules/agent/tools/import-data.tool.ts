import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from './tool.interface';
import { CoreSdkService } from '../../sdk/core-sdk.service';

@Injectable()
export class ImportDataTool implements AgentTool {
  name = 'import_data';
  description = '将解析后的数据导入为对象实例。需要指定对象类型、数据行、externalId列和label列。';
  parameters = {
    type: 'object',
    properties: {
      fileId: { type: 'string', description: '上传文件的 fileId' },
      objectType: { type: 'string', description: '目标对象类型名称' },
      externalIdColumn: { type: 'string', description: '用作唯一标识的列名' },
      labelColumn: { type: 'string', description: '用作显示标签的列名' },
    },
    required: ['fileId', 'objectType', 'externalIdColumn', 'labelColumn'],
  };
  requiresConfirmation = true;

  constructor(private readonly sdk: CoreSdkService) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    return this.sdk.importData(context.user.tenantId, args as any);
  }
}
