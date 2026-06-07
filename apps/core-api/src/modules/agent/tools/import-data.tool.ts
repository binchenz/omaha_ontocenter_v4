import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { AgentTool, ToolContext } from './tool.interface';
import { ImportEngine, UPLOAD_DIR } from '../sdk/import-engine.service';
import { assertCapability } from '../../../common/helpers/assert-capability';

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
    additionalProperties: false,
  };
  requiresConfirmation = true;

  constructor(private readonly importEngine: ImportEngine) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    // ImportEngine is user-context-free by design (ADR-0040); the write-authz gate
    // lives here on the Tool, the only layer holding the actor identity.
    assertCapability(context.user, 'data', 'ingest');
    return this.importEngine.importFile(context.user.tenantId, {
      filePath: path.join(UPLOAD_DIR, args.fileId as string),
      objectType: args.objectType as string,
      externalIdColumn: args.externalIdColumn as string,
      labelColumn: args.labelColumn as string,
    });
  }
}
