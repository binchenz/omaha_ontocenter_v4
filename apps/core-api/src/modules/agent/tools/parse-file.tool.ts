import { Injectable } from '@nestjs/common';
import { AgentTool } from './tool.interface';
import { CoreSdkService } from '../../sdk/core-sdk.service';

@Injectable()
export class ParseFileTool implements AgentTool {
  name = 'parse_file';
  description = '解析上传的文件（Excel/CSV），返回列名、推断的数据类型和样本数据行。';
  parameters = {
    type: 'object',
    properties: {
      fileId: { type: 'string', description: '上传文件返回的 fileId' },
    },
    required: ['fileId'],
  };
  requiresConfirmation = false;

  constructor(private readonly sdk: CoreSdkService) {}

  async execute(args: Record<string, unknown>): Promise<unknown> {
    return this.sdk.parseFile(args.fileId as string);
  }
}
